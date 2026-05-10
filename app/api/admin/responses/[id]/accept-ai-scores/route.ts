/**
 * POST /api/admin/responses/[id]/accept-ai-scores
 *
 * Bulk-accept the AI-suggested scores for every open-ended answer on a
 * response. Picks the provider matching the response's ai_consensus:
 *   - 'override' → Kimi
 *   - 'agree' or 'gemini_only' → Gemini
 *   - 'pending' → 400 (run the pipeline first)
 *
 * Each accepted answer's scoreAwarded is set to the AI suggestion and
 * the scoredBy/scoredAt audit columns are stamped to the requester.
 * Then the response total + pass are recomputed once at the end.
 *
 * Permission: editor or above AND can-run-AI-pipeline (i.e. roles in
 * AI_SCORING_VISIBLE_TO; assessor never qualifies). Same gate as the
 * pipeline endpoint — if you can't see AI scores for the whole response,
 * you can't bulk-accept them.
 */

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { computeResponseFinalScore } from "@/lib/assessment/scoring";
import { requireEditorApi } from "@/lib/auth/admin";
import { canRunAiPipeline } from "@/lib/auth/feature-flags";
import { db } from "@/lib/db/client";
import {
  type AiScoreProvider,
  aiScores,
  answers,
  assessments,
  questions,
  responses,
} from "@/lib/db/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  if (!canRunAiPipeline(auth.session.admin.role)) {
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

  const [response] = await db
    .select({
      id: responses.id,
      assessmentId: responses.assessmentId,
      consensus: responses.aiConsensus,
    })
    .from(responses)
    .where(eq(responses.id, id))
    .limit(1);
  if (!response) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (response.consensus === "pending") {
    return NextResponse.json(
      {
        error: "pipeline_not_run",
        message:
          "Run the AI cross-check first — there are no suggestions to accept yet.",
      },
      { status: 400 },
    );
  }

  // Prefer Kimi if it overrode, otherwise Gemini's row is canonical.
  const provider: AiScoreProvider =
    response.consensus === "override" ? "kimi" : "gemini";

  const openAnswers = await db
    .select({ id: answers.id })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(
      and(eq(answers.responseId, id), eq(questions.type, "open")),
    );
  const openIds = openAnswers.map((a) => a.id);

  if (openIds.length === 0) {
    return NextResponse.json({ accepted: 0, skipped: 0 });
  }

  const aiRows = await db
    .select({
      answerId: aiScores.answerId,
      score: aiScores.score,
    })
    .from(aiScores)
    .where(
      and(eq(aiScores.provider, provider), inArray(aiScores.answerId, openIds)),
    );

  const sourceTag = provider === "kimi" ? "ai_kimi" : "ai_gemini";
  let accepted = 0;
  for (const row of aiRows) {
    await db
      .update(answers)
      .set({
        scoreAwarded: row.score,
        scoreSource: sourceTag,
        scoredBy: auth.session.admin.id,
        scoredAt: new Date(),
      })
      .where(eq(answers.id, row.answerId));
    accepted += 1;
  }

  const skipped = openIds.length - accepted;

  // Recompute response totals + pass once after the loop.
  const allRows = await db
    .select({
      scoreAwarded: answers.scoreAwarded,
      points: questions.points,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, id));
  const awardedList = allRows.map((r) => r.scoreAwarded);
  const maxPossible = allRows.reduce((s, r) => s + r.points, 0);
  const [assessment] = await db
    .select({ passThreshold: assessments.passThreshold })
    .from(assessments)
    .where(eq(assessments.id, response.assessmentId))
    .limit(1);

  const final = computeResponseFinalScore(
    awardedList,
    maxPossible,
    assessment?.passThreshold ?? 70,
  );

  await db
    .update(responses)
    .set({
      totalScore: final.totalScore,
      maxPossibleScore: maxPossible,
      pass: final.pass,
    })
    .where(eq(responses.id, id));

  return NextResponse.json({
    accepted,
    skipped,
    provider,
    total_score: final.totalScore,
    max_possible_score: maxPossible,
    pass: final.pass,
  });
}
