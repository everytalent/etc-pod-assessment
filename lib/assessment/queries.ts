/**
 * Read-only DB helpers shared across the candidate API routes.
 *
 * Each function projects only the columns the candidate is allowed to see —
 * notably, NEVER `correctAnswer`. By using Drizzle's `select({...})` form, the
 * column list is the type contract: the leak is impossible by construction.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  type Assessment,
  assessments,
  answers,
  questions,
} from "@/lib/db/schema";
import type { CandidateQuestion } from "./validators";

/** Subset of assessment fields safe to expose on the public landing. */
export type PublicAssessmentCard = {
  slug: string;
  title: string;
  roleType: Assessment["roleType"];
  introText: string;
};

/**
 * Assessments the public landing page should list. Status must be
 * 'published' AND visibility must be 'listed' — unlisted ones stay
 * link-only.
 */
export async function getListedPublishedAssessments(): Promise<
  PublicAssessmentCard[]
> {
  return db
    .select({
      slug: assessments.slug,
      title: assessments.title,
      roleType: assessments.roleType,
      introText: assessments.introText,
    })
    .from(assessments)
    .where(
      and(
        eq(assessments.status, "published"),
        eq(assessments.visibility, "listed"),
      ),
    )
    .orderBy(asc(assessments.roleType), asc(assessments.title));
}

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

/**
 * Total time budget for an assessment, in minutes. Sums the per-question
 * timeLimitSeconds for timed questions and applies a 30 s / question
 * fallback for un-timed ones (MCQ default reading time). This is the
 * UPPER BOUND — most candidates finish faster — but it's the number we
 * commit to on the intake page so people know what they're signing up
 * for. Returns at least 1.
 */
export async function getAssessmentTimeBudgetMinutes(
  assessmentId: string,
): Promise<number> {
  const rows = await db
    .select({
      timerEnabled: questions.timerEnabled,
      timeLimitSeconds: questions.timeLimitSeconds,
    })
    .from(questions)
    .where(eq(questions.assessmentId, assessmentId));
  if (rows.length === 0) return 1;
  const total = rows.reduce((acc, q) => {
    if (q.timerEnabled && q.timeLimitSeconds) return acc + q.timeLimitSeconds;
    return acc + 30;
  }, 0);
  return Math.max(1, Math.ceil(total / 60));
}

/** Running total = sum of answers.score_awarded so far. */
export async function getRunningScore(responseId: string): Promise<number> {
  const rows = await db
    .select({ scoreAwarded: answers.scoreAwarded })
    .from(answers)
    .where(eq(answers.responseId, responseId));

  return rows.reduce((sum, r) => sum + r.scoreAwarded, 0);
}
