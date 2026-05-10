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

import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { computeResponseFinalScore } from "@/lib/assessment/scoring";
import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, assessments, questions, responses } from "@/lib/db/schema";

const inputSchema = z.object({
  score_awarded: z.number().int(),
  // Optional: 'manual' (default), 'ai_gemini', or 'ai_kimi'. UI sends
  // ai_* when the reviewer accepted an AI suggestion via "Use this score".
  source: z.enum(["manual", "ai_gemini", "ai_kimi"]).default("manual"),
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

  const [answer] = await db
    .select({
      id: answers.id,
      responseId: answers.responseId,
      questionId: answers.questionId,
      questionType: questions.type,
      questionPoints: questions.points,
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

  // Update the answer row with the new score + audit trail.
  await db
    .update(answers)
    .set({
      scoreAwarded: input.score_awarded,
      scoreSource: input.source,
      scoredBy: auth.session.admin.id,
      scoredAt: new Date(),
    })
    .where(eq(answers.id, id));

  // Recompute the parent response's total_score + pass.
  const [{ totalAwarded, totalAnswered }] = await db
    .select({
      totalAwarded: sql<number>`COALESCE(SUM(${answers.scoreAwarded}), 0)::int`,
      totalAnswered: sql<number>`COUNT(*)::int`,
    })
    .from(answers)
    .where(eq(answers.responseId, answer.responseId));

  // max_possible_score is the snapshot of questions the candidate was shown
  // (i.e., questions that have an answer row).
  const [{ maxPossible }] = await db
    .select({
      maxPossible: sql<number>`COALESCE(SUM(${questions.points}), 0)::int`,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, answer.responseId));

  // Look up pass threshold via the response → assessment.
  const [response] = await db
    .select({
      assessmentId: responses.assessmentId,
      passThreshold: assessments.passThreshold,
      status: responses.status,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, answer.responseId))
    .limit(1);
  if (!response) {
    return NextResponse.json({ error: "response_missing" }, { status: 500 });
  }

  // Only update totals when response is finalised — in_progress responses
  // get totals computed at submit time anyway.
  if (response.status !== "in_progress") {
    const final = computeResponseFinalScore(
      // We don't have the per-answer awarded array here, but we already
      // summed it above as totalAwarded. computeResponseFinalScore wants
      // an array — pass a single-entry equivalent.
      [totalAwarded],
      maxPossible,
      response.passThreshold,
    );
    await db
      .update(responses)
      .set({
        totalScore: final.totalScore,
        maxPossibleScore: maxPossible,
        pass: final.pass,
      })
      .where(eq(responses.id, answer.responseId));
  }

  return NextResponse.json({
    answer_id: id,
    score_awarded: input.score_awarded,
    response_total_answered: totalAnswered,
    response_total_score: totalAwarded,
    max_possible: maxPossible,
  });
}
