/**
 * Read-only DB helpers shared across the candidate API routes.
 *
 * Each function projects only the columns the candidate is allowed to see —
 * notably, NEVER `correctAnswer`. By using Drizzle's `select({...})` form, the
 * column list is the type contract: the leak is impossible by construction.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  type Assessment,
  assessments,
  answers,
  questions,
} from "@/lib/db/schema";
import type { CandidateQuestion } from "./validators";

/** Sanitised question — no `correctAnswer`, ever. */
export async function getCandidateQuestion(
  questionId: string,
): Promise<CandidateQuestion | null> {
  const [row] = await db
    .select({
      id: questions.id,
      type: questions.type,
      questionText: questions.questionText,
      options: questions.options,
      points: questions.points,
      negativePoints: questions.negativePoints,
      timerEnabled: questions.timerEnabled,
      timeLimitSeconds: questions.timeLimitSeconds,
      timeoutAction: questions.timeoutAction,
      required: questions.required,
      section: questions.section,
    })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);

  return row ?? null;
}

/**
 * Look up an assessment by URL slug. Used by POST /api/sessions to validate
 * the candidate is starting a real (and published) assessment.
 */
export async function getAssessmentBySlug(
  slug: string,
): Promise<Assessment | null> {
  const [row] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.slug, slug))
    .limit(1);

  return row ?? null;
}

/** Running total = sum of answers.score_awarded so far. */
export async function getRunningScore(responseId: string): Promise<number> {
  const rows = await db
    .select({ scoreAwarded: answers.scoreAwarded })
    .from(answers)
    .where(eq(answers.responseId, responseId));

  return rows.reduce((sum, r) => sum + r.scoreAwarded, 0);
}
