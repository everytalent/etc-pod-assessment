/**
 * Audio archive: move voice answers from Supabase Storage into Zoho
 * WorkDrive, then delete the Supabase object. Resumable per-answer so a
 * partial failure can be re-driven.
 *
 * Storage convention after archive:
 *   answers.audio_path  = 'zoho:<workdrive_file_id>'
 *   (was) audio_path    = '<response_id>/<question_id>'  on Supabase
 *
 * Anything in the codebase that wants to play audio back must consult
 * `audio_path`'s prefix:
 *   - 'zoho:<id>'   → mint Zoho download URL via createShareLink fallback
 *   - otherwise     → mint Supabase Storage signed URL
 */

import { and, eq, isNotNull, isNull, like, not, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { answers, assessments, responses } from "@/lib/db/schema";
import {
  getSupabaseAdmin,
  VOICE_BUCKET,
} from "@/lib/supabase/storage-admin";
import { ensureFolder, uploadFile } from "@/lib/zoho/workdrive";

const ARCHIVE_ROOT_NAME = "etc-pod-archive";

export const ZOHO_AUDIO_PREFIX = "zoho:";

/** Was this audio_path migrated to Zoho already? */
export function isZohoArchived(audioPath: string | null): boolean {
  return Boolean(audioPath && audioPath.startsWith(ZOHO_AUDIO_PREFIX));
}

/** Extract Zoho file id from a 'zoho:<id>' path. */
export function zohoFileIdFromPath(audioPath: string): string {
  return audioPath.startsWith(ZOHO_AUDIO_PREFIX)
    ? audioPath.slice(ZOHO_AUDIO_PREFIX.length)
    : audioPath;
}

export type ArchiveResult = {
  archived: number;
  skippedAlreadyArchived: number;
  failed: number;
  remaining: number;
  errors: { answerId: string; message: string }[];
  /** Path used in WorkDrive: etc-pod-archive/<slug>/. */
  zohoFolderId: string;
};

/**
 * Archive up to {@link limit} unarchived voice answers for the given
 * assessment, optionally scoped to specific response IDs. Returns counts
 * + how many remain so the admin UI can call again to continue.
 */
export async function archiveAssessmentAudio(args: {
  assessmentId: string;
  /** When provided, only audios attached to these response IDs are touched. */
  responseIds?: string[];
  /** Max audios to migrate this call. Defaults to 10 to stay under Netlify timeouts. */
  limit?: number;
}): Promise<ArchiveResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 10, 50));

  // Resolve assessment slug for the WorkDrive folder name.
  const [assessment] = await db
    .select({ slug: assessments.slug })
    .from(assessments)
    .where(eq(assessments.id, args.assessmentId))
    .limit(1);
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  // Find unarchived voice answers within the assessment (and optional
  // responseIds). We filter by audioPath NOT NULL AND NOT LIKE 'zoho:%'.
  // Drizzle: `like(audioPath, 'zoho:%') = true` → archived; we want the
  // opposite, so `not(like(...))`.
  const unarchivedScopeFilters = [
    eq(responses.assessmentId, args.assessmentId),
    isNotNull(answers.audioPath),
    or(isNull(answers.audioPath), not(like(answers.audioPath, "zoho:%")))!,
  ];
  // Apply responseIds filter as additional inArray when present.
  let unarchivedQuery = db
    .select({
      answerId: answers.id,
      responseId: answers.responseId,
      questionId: answers.questionId,
      audioPath: answers.audioPath,
    })
    .from(answers)
    .innerJoin(responses, eq(responses.id, answers.responseId))
    .where(and(...unarchivedScopeFilters))
    .$dynamic();

  if (args.responseIds && args.responseIds.length > 0) {
    // Apply scope inline by re-issuing where with both filters.
    unarchivedQuery = db
      .select({
        answerId: answers.id,
        responseId: answers.responseId,
        questionId: answers.questionId,
        audioPath: answers.audioPath,
      })
      .from(answers)
      .innerJoin(responses, eq(responses.id, answers.responseId))
      .where(
        and(
          eq(responses.assessmentId, args.assessmentId),
          isNotNull(answers.audioPath),
          not(like(answers.audioPath, "zoho:%")),
        ),
      )
      .$dynamic();
  }

  const allUnarchived = await unarchivedQuery;
  const total = allUnarchived.length;
  const batch = allUnarchived.slice(0, limit);

  // Lazy-create the WorkDrive folder for this assessment (idempotent).
  const root = process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID;
  if (!root) {
    throw new Error("ZOHO_WORKDRIVE_ROOT_FOLDER_ID is not set");
  }
  const archiveRootId = await ensureFolder(root, ARCHIVE_ROOT_NAME);
  const assessmentFolderId = await ensureFolder(
    archiveRootId,
    assessment.slug,
  );

  const supa = getSupabaseAdmin();
  const errors: ArchiveResult["errors"] = [];
  let archived = 0;
  let skippedAlreadyArchived = 0;

  for (const ans of batch) {
    if (!ans.audioPath || ans.audioPath.startsWith(ZOHO_AUDIO_PREFIX)) {
      skippedAlreadyArchived += 1;
      continue;
    }
    try {
      // 1. Fetch the audio from Supabase Storage.
      const { data: blob, error: dlErr } = await supa.storage
        .from(VOICE_BUCKET)
        .download(ans.audioPath);
      if (dlErr || !blob) {
        throw new Error(
          `supabase download failed: ${dlErr?.message ?? "no blob"}`,
        );
      }

      const buffer = await blob.arrayBuffer();

      // 2. Upload to WorkDrive. Filename keeps the question id for traceability.
      const filename = `${ans.responseId}__${ans.questionId}.webm`;
      const { id: zohoFileId } = await uploadFile({
        parentId: assessmentFolderId,
        filename,
        contentType: blob.type || "audio/webm",
        body: new Uint8Array(buffer),
        overwrite: true,
      });

      // 3. Flip the answer row's audio_path BEFORE deleting from Supabase.
      //    Order matters: if the delete fails, we still have the new path
      //    pointing at Zoho (good); if step 3 fails, the Supabase object
      //    is still there for retry (also good).
      await db
        .update(answers)
        .set({ audioPath: `${ZOHO_AUDIO_PREFIX}${zohoFileId}` })
        .where(eq(answers.id, ans.answerId));

      // 4. Delete the Supabase object (best-effort — log if it fails).
      const { error: rmErr } = await supa.storage
        .from(VOICE_BUCKET)
        .remove([ans.audioPath]);
      if (rmErr) {
        // Object stays orphan in Supabase; not fatal. Could be GC'd later.
        console.warn(
          `[archive] supabase delete failed for ${ans.audioPath}: ${rmErr.message}`,
        );
      }

      archived += 1;
    } catch (err) {
      errors.push({
        answerId: ans.answerId,
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return {
    archived,
    skippedAlreadyArchived,
    failed: errors.length,
    remaining: Math.max(0, total - archived - skippedAlreadyArchived),
    errors,
    zohoFolderId: assessmentFolderId,
  };
}
