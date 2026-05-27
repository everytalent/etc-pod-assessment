/**
 * Validation-mode answer dispatcher.
 *
 * Called from the hybrid /api/answers route when assessment.mode is
 * 'validation'. Wraps the state machine + picker so the route stays
 * thin.
 *
 * Sequence:
 *   1. Load (or initialise) the per-spec CAT snapshot from
 *      responses.metadata.adaptive_plan
 *   2. Step the snapshot with the latest answer signal
 *   3. Pick the next question from the bank
 *   4. Persist the updated snapshot back to metadata
 *   5. Return { nextQuestionId } or { end: true }
 *
 * MVP scope: single-specialisation flow per response. Multi-spec
 * dispatch (PRD §4 selection screen) is a follow-up — the data model
 * supports it (metadata.adaptive_plan is an array) but the routing
 * across specs isn't yet wired.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  aiScores,
  answers,
  responses,
  type PerformanceLevel,
  type SeniorityBand,
} from "@/lib/db/schema";

import { initialSnapshot, step, type CatSnapshot } from "./state-machine";
import { pickNextValidationQuestion } from "./picker";

export type ValidationFlowResult =
  | { kind: "next"; questionId: string; snapshot: CatSnapshot }
  | { kind: "end"; snapshot: CatSnapshot };

/** Read or create the CAT snapshot for the primary spec on this response. */
export async function loadOrInitSnapshot(args: {
  responseId: string;
  specialisation: string;
  claimedBand: SeniorityBand;
  budget: number;
}): Promise<CatSnapshot> {
  const [resp] = await db
    .select({ metadata: responses.metadata })
    .from(responses)
    .where(eq(responses.id, args.responseId))
    .limit(1);
  // Adaptive plan is stored on metadata.adaptive_plan as an array per
  // spec. MVP: read the first entry that matches our specialisation,
  // or initialise one if missing.
  const meta = (resp?.metadata ?? {}) as Record<string, unknown>;
  const plan =
    (meta.adaptive_plan as Array<CatSnapshot & { specialisation: string }>) ??
    [];
  const existing = plan.find(
    (p) => (p as { specialisation: string }).specialisation === args.specialisation,
  );
  if (existing) return existing;
  return initialSnapshot({
    claimedBand: args.claimedBand,
    budget: args.budget,
  });
}

/**
 * Advance the CAT machine by one answer, pick the next question, and
 * persist the updated snapshot to responses.metadata.adaptive_plan.
 */
export async function advanceValidationFlow(args: {
  responseId: string;
  specialisation: string;
  claimedBand: SeniorityBand;
  budget: number;
  lastAnswerId: string;
  answeredQuestionIds: string[];
}): Promise<ValidationFlowResult> {
  // Load the AI signal for the answer that just landed (band + level).
  // If no AI score yet, the signal is null (CAT will still tick the
  // window count even on null — keeps the engine moving).
  const [score] = await db
    .select({
      bandSignal: aiScores.bandSignal,
      levelSignal: aiScores.levelSignal,
    })
    .from(aiScores)
    .where(eq(aiScores.answerId, args.lastAnswerId))
    .limit(1);

  const snapshot = await loadOrInitSnapshot({
    responseId: args.responseId,
    specialisation: args.specialisation,
    claimedBand: args.claimedBand,
    budget: args.budget,
  });

  const stepResult = step({
    current: snapshot,
    signal: score
      ? {
          bandSignal: score.bandSignal as SeniorityBand | null,
          levelSignal: score.levelSignal as PerformanceLevel | null,
        }
      : null,
  });

  await persistSnapshot({
    responseId: args.responseId,
    specialisation: args.specialisation,
    snapshot: stepResult.snapshot,
  });

  if (stepResult.kind === "end") {
    return { kind: "end", snapshot: stepResult.snapshot };
  }

  // Pick the next question from the bank at the new (band, level).
  const next = await pickNextValidationQuestion({
    specialisation: args.specialisation,
    band: stepResult.pick.band,
    level: stepResult.pick.level,
    excludeQuestionIds: args.answeredQuestionIds,
    targetDifficulty: stepResult.pick.level === "tp" ? 9
      : stepResult.pick.level === "p" ? 7
      : stepResult.pick.level === "g" ? 5
      : stepResult.pick.level === "nh" ? 3 : 2,
  });

  if (!next) {
    // Bank is empty for this cell + neighbours. End the spec — the
    // synthesis step will still produce a profile from what was
    // answered, just with lower confidence.
    return { kind: "end", snapshot: stepResult.snapshot };
  }

  return {
    kind: "next",
    questionId: next.id,
    snapshot: stepResult.snapshot,
  };
}

/** Used by POST /api/sessions/select-specialisations to bootstrap. */
export async function pickFirstQuestion(args: {
  specialisation: string;
  claimedBand: SeniorityBand;
}): Promise<{ questionId: string } | { kind: "no_questions" }> {
  const q = await pickNextValidationQuestion({
    specialisation: args.specialisation,
    band: args.claimedBand,
    level: "g", // start at Growing per PRD §4
    excludeQuestionIds: [],
    targetDifficulty: 5,
  });
  if (!q) return { kind: "no_questions" };
  return { questionId: q.id };
}

/* ---------- Helpers ---------- */

async function persistSnapshot(args: {
  responseId: string;
  specialisation: string;
  snapshot: CatSnapshot;
}): Promise<void> {
  const [row] = await db
    .select({ metadata: responses.metadata })
    .from(responses)
    .where(eq(responses.id, args.responseId))
    .limit(1);
  const meta = (row?.metadata ?? {}) as Record<string, unknown>;
  const plan =
    (meta.adaptive_plan as Array<CatSnapshot & { specialisation: string }>) ??
    [];
  const idx = plan.findIndex(
    (p) => (p as { specialisation: string }).specialisation === args.specialisation,
  );
  const next = { ...args.snapshot, specialisation: args.specialisation };
  if (idx >= 0) {
    plan[idx] = next as CatSnapshot & { specialisation: string };
  } else {
    plan.push(next as CatSnapshot & { specialisation: string });
  }
  meta.adaptive_plan = plan;
  await db
    .update(responses)
    .set({ metadata: meta as never })
    .where(eq(responses.id, args.responseId));
  void answers; // silence unused import
}
