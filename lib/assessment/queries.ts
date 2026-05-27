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
      // Validation Engine interactive types need this on the candidate
      // side so the answer component can render its custom input.
      // Null for non-interactive types.
      interactiveConfig: questions.interactiveConfig,
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
 * Realistic time-to-complete range for an assessment, in minutes.
 *
 * We deliberately do NOT show the worst-case sum of every timer because
 * (a) candidates rarely use the full per-question allowance and (b) a
 * visible 53-minute ceiling lets a candidate plan to drag every timer
 * to make follow-up scheming or answer searching easier. Instead we
 * show a tighter range based on typical pacing — 40% of max on the low
 * end, 65% on the high end. For Renewvia (53 min ceiling) that lands
 * at ~21–34 min, which matches observed completion times.
 */
export async function getAssessmentTimeRange(
  assessmentId: string,
): Promise<{ lowMinutes: number; highMinutes: number }> {
  const rows = await db
    .select({
      timerEnabled: questions.timerEnabled,
      timeLimitSeconds: questions.timeLimitSeconds,
    })
    .from(questions)
    .where(eq(questions.assessmentId, assessmentId));
  if (rows.length === 0) return { lowMinutes: 1, highMinutes: 1 };
  const totalSeconds = rows.reduce((acc, q) => {
    if (q.timerEnabled && q.timeLimitSeconds) return acc + q.timeLimitSeconds;
    return acc + 30;
  }, 0);
  const lowMinutes = Math.max(1, Math.round((totalSeconds * 0.4) / 60));
  const highMinutes = Math.max(
    lowMinutes + 5,
    Math.round((totalSeconds * 0.65) / 60),
  );
  return { lowMinutes, highMinutes };
}

/**
 * Past answers on this response, joined with their questions and shaped
 * into the candidate-facing locked-bubble entry shape. Used to resume
 * the chat history after a refresh — without this, the bubbles above
 * the active question disappear and the progress bar reads from the
 * wrong base.
 */
export type ResumedHistoryEntry = {
  questionId: string;
  questionText: string;
  selectedOptions: string[];
  selectedLabel: string | null;
  textResponse: string | null;
  audioPath: string | null;
  scoreDelta: number;
};

export async function getAnsweredHistory(
  responseId: string,
): Promise<ResumedHistoryEntry[]> {
  const rows = await db
    .select({
      questionId: answers.questionId,
      questionText: questions.questionText,
      questionType: questions.type,
      options: questions.options,
      selectedOptions: answers.selectedOptions,
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      scoreAwarded: answers.scoreAwarded,
      answeredAt: answers.answeredAt,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, responseId))
    .orderBy(answers.answeredAt);
  return rows.map((r) => ({
    questionId: r.questionId,
    questionText: r.questionText,
    selectedOptions: r.selectedOptions,
    selectedLabel:
      r.questionType === "open"
        ? null
        : r.selectedOptions
            .map(
              (id) => r.options.find((o) => o.id === id)?.label ?? id,
            )
            .join(", ") || null,
    textResponse: r.textResponse,
    audioPath: r.audioPath,
    scoreDelta: r.scoreAwarded,
  }));
}

/** Running total = sum of answers.score_awarded so far. */
export async function getRunningScore(responseId: string): Promise<number> {
  const rows = await db
    .select({ scoreAwarded: answers.scoreAwarded })
    .from(answers)
    .where(eq(answers.responseId, responseId));

  return rows.reduce((sum, r) => sum + r.scoreAwarded, 0);
}
