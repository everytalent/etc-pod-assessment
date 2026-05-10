/**
 * POST /api/admin/assessments/[id]/responses/export-zoho
 *
 * Generates the responses CSV (same shape as the local CSV download),
 * uploads it to the assessment's folder in Zoho WorkDrive, and returns the
 * file URL.
 *
 * Body (all optional):
 *   {
 *     response_ids?: string[]    // when omitted, exports all (preview-tagged
 *                                // responses are excluded by default).
 *     archive_audio?: boolean    // reserved — audio archive flow lands in
 *                                // a follow-up commit. For now this flag is
 *                                // accepted but ignored.
 *   }
 *
 * Response:
 *   {
 *     workdrive_file_id, workdrive_file_url, file_name,
 *     response_count, voice_answer_count, voice_total_seconds,
 *     archive_started: false  // until phase 2 lands
 *   }
 *
 * Permission: editor or above (CAN.exportResponses).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { buildResponsesCsv } from "@/lib/admin/responses-csv";
import { requireEditorApi } from "@/lib/auth/admin";
import { ensureFolder, uploadFile, workDriveFileUrl } from "@/lib/zoho/workdrive";

const inputSchema = z.object({
  response_ids: z.array(z.string().uuid()).max(2000).optional(),
  archive_audio: z.boolean().optional(),
});

const ARCHIVE_ROOT_NAME = "etc-pod-archive";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = inputSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // 1. Build the CSV in memory.
  let csvResult;
  try {
    csvResult = await buildResponsesCsv({
      assessmentId: id,
      responseIds: input.response_ids,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Assessment not found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }

  if (csvResult.responseCount === 0) {
    return NextResponse.json(
      { error: "no_responses", message: "Nothing to export." },
      { status: 400 },
    );
  }

  // 2. Resolve WorkDrive folders: <root>/etc-pod-archive/<assessment-slug>/.
  const root = process.env.ZOHO_WORKDRIVE_ROOT_FOLDER_ID;
  if (!root) {
    return NextResponse.json(
      {
        error: "zoho_not_configured",
        message: "ZOHO_WORKDRIVE_ROOT_FOLDER_ID is not set.",
      },
      { status: 500 },
    );
  }

  let archiveRootId: string;
  let assessmentFolderId: string;
  try {
    archiveRootId = await ensureFolder(root, ARCHIVE_ROOT_NAME);
    assessmentFolderId = await ensureFolder(
      archiveRootId,
      csvResult.assessmentSlug,
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "zoho_folder_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }

  // 3. Upload the CSV.
  const filename = `responses-${new Date().toISOString().slice(0, 10)}.csv`;
  let uploaded: { id: string; name: string };
  try {
    uploaded = await uploadFile({
      parentId: assessmentFolderId,
      filename,
      contentType: "text/csv; charset=utf-8",
      body: csvResult.csv,
      overwrite: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "zoho_upload_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    workdrive_file_id: uploaded.id,
    workdrive_file_url: workDriveFileUrl(uploaded.id),
    file_name: uploaded.name,
    response_count: csvResult.responseCount,
    voice_answer_count: csvResult.voiceAnswerCount,
    voice_total_seconds: csvResult.voiceTotalSeconds,
    // Reserved for the follow-up commit that wires archive.
    archive_started: false,
    archive_requested: input.archive_audio === true,
  });
}
