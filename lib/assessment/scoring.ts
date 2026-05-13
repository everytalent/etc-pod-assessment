/**
 * Per-answer scoring rules — PRD §5.4.
 *
 *   timedOut + timeout_action='skip'           → 0
 *   timedOut + timeout_action='mark_incorrect' → -negative_points
 *   timedOut + timeout_action='auto_submit'    → fall through to normal scoring
 *   correct                                    → +points
 *   incorrect                                  → -negative_points
 *
 * Final score = sum of answers.score_awarded.
 * Pass = total_score / max_possible_score >= pass_threshold/100.
 *
 * Pure module — no DB, no I/O. The DB-bound `finalizeResponse` lives in engine.ts.
 */

import type { IntegrityLevel, Question } from "@/lib/db/schema";

type ScorableQuestion = Pick<
  Question,
  "points" | "negativePoints" | "correctAnswer" | "timeoutAction"
>;

export function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isCorrectAnswer(
  question: Pick<Question, "correctAnswer">,
  selected: readonly string[],
): boolean {
  return arraysEqual(
    [...selected].sort(),
    [...question.correctAnswer].sort(),
  );
}

/**
 * Score one answer. Returns the integer to add to the running total.
 * May be negative when negative_points > 0.
 */
export function scoreAnswer(
  question: ScorableQuestion,
  selected: readonly string[],
  timedOut: boolean,
): number {
  if (timedOut) {
    if (question.timeoutAction === "skip") return 0;
    if (question.timeoutAction === "mark_incorrect") return -question.negativePoints;
    // auto_submit: fall through to normal scoring with whatever was selected.
  }
  return isCorrectAnswer(question, selected)
    ? question.points
    : -question.negativePoints;
}

/**
 * Apply the integrity-level penalty to a single answer's raw score.
 *
 *   null / 'low' → no change (low is informational only)
 *   'mid'        → 0 (this answer doesn't count)
 *   'high'       → score - 1 (one-point penalty, may go negative)
 *
 * Raw score_awarded is never mutated; this is only used at total-roll-up
 * time so the assessor's grading judgement is preserved in the DB.
 */
export function applyIntegrityToAnswer(
  scoreAwarded: number,
  integrityLevel: IntegrityLevel | null,
): number {
  if (integrityLevel === "mid") return 0;
  if (integrityLevel === "high") return scoreAwarded - 1;
  return scoreAwarded;
}

/**
 * Roll up a response. Total = sum of score_awarded; pass uses pass_threshold%.
 *
 * `maxPossibleScore` is taken as a snapshot from the questions the candidate
 * was actually shown — not the full assessment — so branching that skips
 * sections doesn't unfairly penalise the denominator.
 */
export function computeResponseFinalScore(
  awarded: readonly number[],
  maxPossibleScore: number,
  passThresholdPercent: number,
): { totalScore: number; pass: boolean } {
  const totalScore = awarded.reduce((s, n) => s + n, 0);
  if (maxPossibleScore <= 0) {
    return { totalScore, pass: false };
  }
  const pass = totalScore / maxPossibleScore >= passThresholdPercent / 100;
  return { totalScore, pass };
}
