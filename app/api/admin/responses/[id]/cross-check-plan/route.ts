/**
 * GET  /api/admin/responses/[id]/cross-check-plan
 *
 * Returns the work the client needs to drive through the cross-check
 * pipeline. The client picks each step from this plan and POSTs to
 * /api/admin/answers/[id]/cross-check-step.
 *
 * Response:
 *   {
 *     scorable: [{ answerId, maxPoints, needsTranscription }],
 *     skipped:  string[],                    // human-readable reasons
 *     existing: { gemini: string[], kimi: string[] }  // answer ids already scored
 *   }
 *
 * POST /api/admin/responses/[id]/cross-check-plan
 *
 * Finalizes consensus once the client has scored what it intended to
 * score. Reads the persisted ai_scores rows, computes mean abs diff on
 * the answers where BOTH providers scored, applies the threshold, and
 * stamps ai_consensus + ai_pipeline_ran_at on the response.
 *
 * Body: { agree_threshold?: number = 1.0 }
 * Returns: { consensus, sample_size, sample_diff }
 *
 * Both halves are lib/assessment/ai-cross-check.ts, shared with the
 * automatic scoring that runs on submission.
 *
 * Permission: editor or above AND can-run-AI-pipeline.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { finalizeConsensus, planForResponse } from "@/lib/assessment/ai-cross-check";
import { requireEditorApi } from "@/lib/auth/admin";
import { canRunAiPipeline, loadAiScoringRoles } from "@/lib/auth/feature-flags";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
    return NextResponse.json({ error: "ai_pipeline_disabled" }, { status: 403 });
  }
  const { id } = await params;
  return NextResponse.json(await planForResponse(id));
}

const finalizeSchema = z.object({
  agree_threshold: z.number().min(0).max(10).default(1.0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
    return NextResponse.json({ error: "ai_pipeline_disabled" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = finalizeSchema.safeParse(await req.json().catch(() => ({})));
  const threshold = parsed.success ? parsed.data.agree_threshold : 1.0;

  const result = await finalizeConsensus(id, threshold);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
