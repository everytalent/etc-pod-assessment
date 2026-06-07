/**
 * Per-question timing matrix (PRD §2a).
 *
 * Each question carries its own expected-completion timer derived from
 * a small matrix of multipliers:
 *
 *   base (by type)  ×  band multiplier  ×  language multiplier  ×  accessibility multiplier
 *
 * Inputs are kept narrow on purpose — the runner shouldn't have to
 * understand the matrix internals. Call this once per question with
 * the four factors and use the returned seconds value to drive the
 * countdown.
 *
 * No global assessment timer exists. The candidate runner shows the
 * timer for the current question only.
 */

import type { PerformanceLevel, SeniorityBand } from "@/lib/db/schema";

export type QuestionType =
  | "mcq"
  | "true_false"
  | "open"
  | "voice"
  | "file"
  | "formula"
  | "hotspot"
  | "sequence"
  | "slider"
  | "matching"
  | "scenario";

/** Base seconds per question type. PRD §2a midpoints. */
const BASE_BY_TYPE: Partial<Record<QuestionType, number>> = {
  mcq: 75,
  true_false: 45,
  open: 240,
  voice: 240,
  hotspot: 90,
  sequence: 150,
  slider: 60,
  matching: 90,
  scenario: 300,
  formula: 180,
  file: 600,
};

const DEFAULT_BASE_SECONDS = 90;

/** Senior bands carry +30-50% on the same type vs junior. */
function bandMultiplier(band: SeniorityBand | null): number {
  switch (band) {
    case "senior":
      return 1.4;
    case "mid":
      return 1.15;
    case "junior":
      return 1.0;
    default:
      return 1.0;
  }
}

/** "Below Standard" cells are calibrated for the easiest case. */
function levelMultiplier(level: PerformanceLevel | null): number {
  switch (level) {
    case "below":
      return 0.9;
    case "nh":
      return 1.0;
    case "g":
      return 1.0;
    case "p":
      return 1.1;
    case "tp":
      return 1.2;
    default:
      return 1.0;
  }
}

/** Non-English response language: +25% on every question. */
function languageMultiplier(responseLanguage: string): number {
  if (!responseLanguage || responseLanguage.toLowerCase() === "english") {
    return 1.0;
  }
  return 1.25;
}

/** Accessibility self-declared at start: +50%. */
function accessibilityMultiplier(accessibilityFlag: boolean): number {
  return accessibilityFlag ? 1.5 : 1.0;
}

export type TimingInputs = {
  questionType: QuestionType;
  band: SeniorityBand | null;
  level: PerformanceLevel | null;
  responseLanguage: string;
  accessibilityFlag: boolean;
};

export function expectedSecondsForQuestion(inputs: TimingInputs): number {
  const base = BASE_BY_TYPE[inputs.questionType] ?? DEFAULT_BASE_SECONDS;
  const seconds =
    base *
    bandMultiplier(inputs.band) *
    levelMultiplier(inputs.level) *
    languageMultiplier(inputs.responseLanguage) *
    accessibilityMultiplier(inputs.accessibilityFlag);
  return Math.round(seconds);
}

/**
 * "Going deeper" interstitial trigger (PRD §2a). Returns true exactly
 * once per assessment — at question 15 if the run looks like it's
 * going to extend past the typical 15-20 window.
 */
export function shouldShowGoingDeeperInterstitial(args: {
  questionIndex: number;
  totalSoFar: number;
  alreadyShown: boolean;
}): boolean {
  if (args.alreadyShown) return false;
  if (args.questionIndex !== 15) return false;
  // The runner has already decided to keep probing past 15 — that's
  // the signal. We don't need a confidence read here; just show it
  // the first time we cross the threshold.
  return args.totalSoFar >= 15;
}
