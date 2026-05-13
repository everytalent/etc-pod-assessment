/**
 * PATCH /api/admin/answers/[id]/score
 *
 * Manually score an open-ended answer (text or voice). Recomputes the parent
 * response's total_score + pass after the update so the dashboard reflects
 * the change immediately.
 *
 * Auth: any allow-listed admin can score (for now). If you want only
 * superadmins to score, swap to requireSuperAdminApi.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, questions, scoreHistory } from "@/lib/db/schema";

const inputSchema = z.object({
  score_awarded: z.number().int(),
  // Optional: 'manual' (default), 'ai_gemini', or 'ai_kimi'. UI sends
  // ai_* when the reviewer accepted an AI suggestion via "Use this score".
  source: z.enum(["manual", "ai_gemini", "ai_kimi"]).default("manual"),
  // Required for source='manual' (humans must explain their score for
  // AI-training purposes). Optional for ai_* sources — the model's own
  // rationale already lives on ai_scores.rationale.
  rationale: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Humans must justify their own scores. Accepting an AI suggestion
  // ('ai_gemini'/'ai_kimi') uses the AI's rationale and so doesn't need
  // one from the reviewer.
  if (input.source === "manual" && (!input.rationale || input.rationale.length === 0)) {
    return NextResponse.json(
      {
        error: "rationale_required",
        message: "Manual scores need a short rationale.",
      },
      { status: 400 },
    );
  }

  const [answer] = await db
    .select({
      id: answers.id,
      responseId: answers.responseId,
      questionId: answers.questionId,
      questionType: questions.type,
      questionPoints: questions.points,
      prevScoreAwarded: answers.scoreAwarded,
      prevScoreSource: answers.scoreSource,
      prevScoreRationale: answers.scoreRationale,
      prevScoredBy: answers.scoredBy,
      prevScoredAt: answers.scoredAt,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.id, id))
    .limit(1);

  if (!answer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (answer.questionType !== "open") {
    return NextResponse.json(
      {
        error: "not_scorable_manually",
        message: "Only open-ended answers can be scored manually.",
      },
      { status: 400 },
    );
  }
  if (input.score_awarded < 0 || input.score_awarded > answer.questionPoints) {
    return NextResponse.json(
      {
        error: "out_of_range",
        message: `Score must be between 0 and ${answer.questionPoints}.`,
      },
      { status: 400 },
    );
  }

  // Snapshot the prior score into history *if* an earlier score existed.
  // First save (scoredAt = null) is a creation, not a replacement, so no
  // history row. Subsequent saves capture whatever was there before — even
  // an AI-accepted score — so we can train on (answer, prior-rationale →
  // score) pairs including human disagreements.
  if (answer.prevScoredAt !== null) {
    await db.insert(scoreHistory).values({
      answerId: id,
      scoreAwarded: answer.prevScoreAwarded,
      scoreSource: answer.prevScoreSource,
      scoreRationale: answer.prevScoreRationale,
      scoredBy: answer.prevScoredBy,
      scoredAt: answer.prevScoredAt,
      replacedBy: auth.session.admin.id,
    });
  }

  // Update the answer row with the new score + audit trail.
  await db
    .update(answers)
    .set({
      scoreAwarded: input.score_awarded,
      scoreSource: input.source,
      scoreRationale:
        input.source === "manual" ? (input.rationale ?? "") : (input.rationale ?? null),
      scoredBy: auth.session.admin.id,
      scoredAt: new Date(),
    })
    .where(eq(answers.id, id));

  // Recompute the parent response's totals via the shared helper, which
  // applies integrity penalties and gates on response status.
  const totals = await recomputeResponseTotals(answer.responseId);

  return NextResponse.json({
    answer_id: id,
    score_awarded: input.score_awarded,
    response_total_answered: totals.totalAnswered,
    response_total_score: totals.totalAwarded,
    max_possible: totals.maxPossible,
  });
}
