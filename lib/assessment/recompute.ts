/**
 * Server-side response total recompute, integrity-aware.
 *
 * Called from any endpoint that mutates a per-answer dimension that
 * could change the response total: PATCH score, PATCH integrity, and
 * the future response-level integrity-% setter.
 *
 * Logic:
 *   1. Sum each answer's effective score (raw score_awarded adjusted by
 *      integrity_level: 'mid' → 0, 'high' → score - 1, else unchanged).
 *   2. max_possible_score = sum of points of every question that has an
 *      answer row (snapshot of what the candidate actually saw).
 *   3. Pass = total_score / max_possible_score ≥ pass_threshold/100.
 *
 * Only runs for non-in_progress responses. in_progress responses get
 * their totals at submit time via finalizeResponse, and a half-graded
 * total would be misleading in the dashboard.
 */
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { answers, assessments, questions, responses } from "@/lib/db/schema";

import { computeResponseFinalScore } from "./scoring";

export async function recomputeResponseTotals(
  responseId: string,
): Promise<{
  totalAwarded: number;
  maxPossible: number;
  totalAnswered: number;
  updated: boolean;
}> {
  // Integrity-aware sum. CASE expression handles each level inline so
  // we keep this to a single round-trip.
  const [totals] = await db
    .select({
      totalAwarded: sql<number>`
        COALESCE(SUM(
          CASE
            WHEN ${answers.integrityLevel} = 'mid' THEN 0
            WHEN ${answers.integrityLevel} = 'high' THEN ${answers.scoreAwarded} - 1
            ELSE ${answers.scoreAwarded}
          END
        ), 0)::int
      `,
      totalAnswered: sql<number>`COUNT(*)::int`,
    })
    .from(answers)
    .where(eq(answers.responseId, responseId));

  const [maxRow] = await db
    .select({
      maxPossible: sql<number>`COALESCE(SUM(${questions.points}), 0)::int`,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, responseId));

  const totalAwarded = totals?.totalAwarded ?? 0;
  const totalAnswered = totals?.totalAnswered ?? 0;
  const maxPossible = maxRow?.maxPossible ?? 0;

  const [responseRow] = await db
    .select({
      passThreshold: assessments.passThreshold,
      status: responses.status,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!responseRow) {
    return { totalAwarded, maxPossible, totalAnswered, updated: false };
  }

  if (responseRow.status === "in_progress") {
    return { totalAwarded, maxPossible, totalAnswered, updated: false };
  }

  const final = computeResponseFinalScore(
    [totalAwarded],
    maxPossible,
    responseRow.passThreshold,
  );
  await db
    .update(responses)
    .set({
      totalScore: final.totalScore,
      maxPossibleScore: maxPossible,
      pass: final.pass,
    })
    .where(eq(responses.id, responseId));

  return { totalAwarded, maxPossible, totalAnswered, updated: true };
}
