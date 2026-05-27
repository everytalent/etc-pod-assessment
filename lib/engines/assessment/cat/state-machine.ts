/**
 * CAT (Computerised Adaptive Testing) state machine — PRD §4.
 *
 * Pure function: (state, lastAnswerSignal, candidateProfile, questionBankFacts)
 *   → (nextState, nextQuestionPick | end)
 *
 * No DB, no IO. Drives the per-specialisation flow:
 *   Calibrating  → 3 questions at (claimed_band, growing)
 *   Probing Up   → 2-3 questions at (band+1, growing) when estimate is high
 *   Probing Down → 2-3 questions at (band-1, pro) when estimate is low
 *   Refining     → fill remaining budget at locked (band, level±)
 *   Stabilised   → done
 *
 * Promotion/demotion is bounded to ±1 band from the claim. The CAT
 * engine never jumps a candidate 2 bands in one session.
 */

import type {
  PerformanceLevel,
  SeniorityBand,
} from "@/lib/db/schema";

/* ---------- Types ---------- */

export type CatState =
  | "calibrating"
  | "probing_up"
  | "probing_down"
  | "refining"
  | "stabilised";

/** Numeric ordinal for level math: below=0 … tp=4 */
const LEVEL_RANK: Record<PerformanceLevel, number> = {
  below: 0,
  nh: 1,
  g: 2,
  p: 3,
  tp: 4,
};

const LEVEL_BY_RANK: Record<number, PerformanceLevel> = {
  0: "below",
  1: "nh",
  2: "g",
  3: "p",
  4: "tp",
};

const BAND_RANK: Record<SeniorityBand, number> = {
  junior: 0,
  mid: 1,
  senior: 2,
};

const BAND_BY_RANK: Record<number, SeniorityBand> = {
  0: "junior",
  1: "mid",
  2: "senior",
};

export type CatSnapshot = {
  state: CatState;
  /** Claimed band — never changes during a session. */
  claimedBand: SeniorityBand;
  /** Currently focused band (may differ from claimed during probing). */
  focusBand: SeniorityBand;
  /** Currently focused level (the next-question target). */
  focusLevel: PerformanceLevel;
  /** Running mean of level signals from answered questions, in [0, 4]. */
  estimateLevel: number;
  /** Number of answers used in the current state's window. */
  windowCount: number;
  /** Number of questions answered total (across all states). */
  answeredCount: number;
  /** Per-spec budget. Stops when reached. */
  budget: number;
  /** Once a probe lands, this gets set to the new band; null until then. */
  lockedBand: SeniorityBand | null;
  /** Trace of state transitions for the response.metadata.adaptive_plan column. */
  transitions: Array<{ atAnswer: number; from: CatState; to: CatState; reason: string }>;
};

export type AnswerSignal = {
  /** Level signal from AI (or pass-through for MCQ correct/wrong) */
  levelSignal: PerformanceLevel | null;
  /** What band the AI thought the answer reflected */
  bandSignal: SeniorityBand | null;
};

export type NextPick = {
  band: SeniorityBand;
  level: PerformanceLevel;
};

export type CatStepResult =
  | { kind: "next"; snapshot: CatSnapshot; pick: NextPick }
  | {
      kind: "end";
      snapshot: CatSnapshot;
      finalBand: SeniorityBand;
      finalLevel: PerformanceLevel;
    };

/* ---------- Constructors ---------- */

export function initialSnapshot(args: {
  claimedBand: SeniorityBand;
  budget: number;
}): CatSnapshot {
  return {
    state: "calibrating",
    claimedBand: args.claimedBand,
    focusBand: args.claimedBand,
    focusLevel: "g", // start at Growing per PRD §4
    estimateLevel: LEVEL_RANK.g, // 2.0 baseline
    windowCount: 0,
    answeredCount: 0,
    budget: args.budget,
    lockedBand: null,
    transitions: [],
  };
}

/* ---------- Step ---------- */

const CALIBRATING_WINDOW = 3;
const PROBING_WINDOW = 3;

export function step(args: {
  current: CatSnapshot;
  signal: AnswerSignal | null; // null = first call (no answer yet)
}): CatStepResult {
  const { current, signal } = args;
  const next: CatSnapshot = { ...current, transitions: [...current.transitions] };

  // Update estimate using the new signal (only if we have one).
  if (signal && signal.levelSignal) {
    const rank = LEVEL_RANK[signal.levelSignal];
    // Rolling mean over the window — recency-weighted at 0.7 for the
    // newest data, 0.3 for prior history. Simpler than CAT IRT models
    // but adequate for the ETC validation use case.
    next.estimateLevel = 0.3 * next.estimateLevel + 0.7 * rank;
    next.windowCount = next.windowCount + 1;
    next.answeredCount = next.answeredCount + 1;
  }

  // Budget exhaustion always wins.
  if (next.answeredCount >= next.budget) {
    next.state = "stabilised";
    return finalise(next);
  }

  // State transitions.
  if (next.state === "calibrating" && next.windowCount >= CALIBRATING_WINDOW) {
    if (next.estimateLevel >= LEVEL_RANK.p) {
      const promoted = bumpBand(next.claimedBand, +1);
      if (promoted) {
        recordTransition(next, "calibrating", "probing_up", "estimate ≥ Pro");
        next.state = "probing_up";
        next.focusBand = promoted;
        next.focusLevel = "g";
        next.windowCount = 0;
      } else {
        // Already at top band — refine instead of probing further up.
        recordTransition(next, "calibrating", "refining", "claimed=senior, can't promote");
        next.state = "refining";
        next.lockedBand = next.claimedBand;
        next.windowCount = 0;
      }
    } else if (next.estimateLevel <= LEVEL_RANK.below) {
      const demoted = bumpBand(next.claimedBand, -1);
      if (demoted) {
        recordTransition(next, "calibrating", "probing_down", "estimate ≤ Below");
        next.state = "probing_down";
        next.focusBand = demoted;
        next.focusLevel = "p";
        next.windowCount = 0;
      } else {
        recordTransition(next, "calibrating", "refining", "claimed=junior, can't demote");
        next.state = "refining";
        next.lockedBand = next.claimedBand;
        next.windowCount = 0;
      }
    } else {
      recordTransition(next, "calibrating", "refining", "estimate in band");
      next.state = "refining";
      next.lockedBand = next.claimedBand;
      next.windowCount = 0;
    }
  } else if (
    next.state === "probing_up" &&
    next.windowCount >= PROBING_WINDOW
  ) {
    if (next.estimateLevel >= LEVEL_RANK.g) {
      // Promotion confirmed.
      recordTransition(next, "probing_up", "refining", "promotion confirmed");
      next.state = "refining";
      next.lockedBand = next.focusBand;
      next.windowCount = 0;
    } else {
      // Revert to claimed band at Pro/Top.
      recordTransition(next, "probing_up", "refining", "probe failed; revert to claim");
      next.state = "refining";
      next.lockedBand = next.claimedBand;
      next.focusBand = next.claimedBand;
      next.focusLevel = "p";
      next.windowCount = 0;
    }
  } else if (
    next.state === "probing_down" &&
    next.windowCount >= PROBING_WINDOW
  ) {
    if (next.estimateLevel <= LEVEL_RANK.p) {
      recordTransition(next, "probing_down", "refining", "demotion confirmed");
      next.state = "refining";
      next.lockedBand = next.focusBand;
      next.windowCount = 0;
    } else {
      recordTransition(next, "probing_down", "refining", "probe failed; revert to claim");
      next.state = "refining";
      next.lockedBand = next.claimedBand;
      next.focusBand = next.claimedBand;
      next.focusLevel = "nh";
      next.windowCount = 0;
    }
  } else if (next.state === "refining") {
    // Adjust focus_level toward the running estimate within the locked band.
    if (next.lockedBand) {
      next.focusBand = next.lockedBand;
    }
    const targetRank = Math.max(0, Math.min(4, Math.round(next.estimateLevel)));
    next.focusLevel = LEVEL_BY_RANK[targetRank];
  }

  // Pick the next question target = (focusBand, focusLevel).
  return {
    kind: "next",
    snapshot: next,
    pick: { band: next.focusBand, level: next.focusLevel },
  };
}

/* ---------- Helpers ---------- */

function finalise(s: CatSnapshot): CatStepResult {
  const finalLevelRank = Math.max(0, Math.min(4, Math.round(s.estimateLevel)));
  const finalBand = s.lockedBand ?? s.focusBand ?? s.claimedBand;
  return {
    kind: "end",
    snapshot: s,
    finalBand,
    finalLevel: LEVEL_BY_RANK[finalLevelRank],
  };
}

function bumpBand(band: SeniorityBand, delta: 1 | -1): SeniorityBand | null {
  const next = BAND_RANK[band] + delta;
  if (next < 0 || next > 2) return null;
  return BAND_BY_RANK[next];
}

function recordTransition(
  s: CatSnapshot,
  from: CatState,
  to: CatState,
  reason: string,
): void {
  s.transitions.push({ atAnswer: s.answeredCount, from, to, reason });
}
