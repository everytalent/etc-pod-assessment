/**
 * POST /api/admin/assessments/[id]/responses/archive-audio
 *
 * Migrates voice answers from Supabase Storage to Zoho WorkDrive.
 * Resumable in batches: returns counts + how many remain so the UI can
 * call again to continue.
 *
 * Body (all optional):
 *   {
 *     response_ids?: string[],   // scope to specific responses; default = all
 *     limit?: number,            // 1..50 audios per call; default 10
 *   }
 *
 * Response:
 *   {
 *     archived: int,                   // successfully migrated this call
 *     skipped_already_archived: int,
 *     failed: int,
 *     remaining: int,                  // how many more to do; call again if > 0
 *     errors: { answer_id, message }[],
 *     zoho_folder_id: string,          // workdrive folder for this assessment
 *   }
 *
 * Permission: editor or above (CAN.archiveAudio).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { archiveAssessmentAudio } from "@/lib/zoho/archive";

const inputSchema = z.object({
  response_ids: z.array(z.string().uuid()).max(2000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

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

  let result;
  try {
    result = await archiveAssessmentAudio({
      assessmentId: id,
      responseIds: input.response_ids,
      limit: input.limit,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Assessment not found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        error: "archive_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    archived: result.archived,
    skipped_already_archived: result.skippedAlreadyArchived,
    failed: result.failed,
    remaining: result.remaining,
    errors: result.errors.map((e) => ({
      answer_id: e.answerId,
      message: e.message,
    })),
    zoho_folder_id: result.zohoFolderId,
  });
}
