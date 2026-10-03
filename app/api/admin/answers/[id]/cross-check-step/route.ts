/**
 * POST /api/admin/answers/[id]/cross-check-step
 *
 * One unit of work in the cross-check pipeline: score a single answer
 * with a single provider (Gemini or Kimi) and persist the result. The
 * client calls this in a loop so we don't hit Netlify's 30 s function
 * timeout on long assessments — same shape as the audio archive batch
 * loop. The work itself lives in lib/assessment/ai-cross-check.ts and is
 * shared with the automatic scoring that runs on submission.
 *
 * Body: { provider: 'gemini' | 'kimi' }
 * Returns: { score, rationale, hits, misses, redFlagsTriggered }
 *
 * Permission: editor or above AND can-run-AI-pipeline.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { CrossCheckError, scoreAnswerWithProvider } from "@/lib/assessment/ai-cross-check";
import { requireEditorApi } from "@/lib/auth/admin";
import { canRunAiPipeline, loadAiScoringRoles } from "@/lib/auth/feature-flags";

const inputSchema = z.object({
  provider: z.enum(["gemini", "kimi"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
    return NextResponse.json(
      {
        error: "ai_pipeline_disabled",
        message:
          "AI scoring isn't available for your role yet. Ask a super admin if you should have access.",
      },
      { status: 403 },
    );
  }
  const { id } = await params;

  const parsed = inputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const result = await scoreAnswerWithProvider(id, parsed.data.provider);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CrossCheckError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "ai_failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 502 },
    );
  }
}
