/**
 * Shared types for the question type framework.
 */

import type { z } from "zod";

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

/**
 * Deterministic auto-score output.
 *   score   — points earned (0..max)
 *   max     — points possible
 *   signals — optional metadata (e.g. "exact_match", "within_tolerance")
 *   reason  — short human-readable explanation, shown in admin drill-in
 */
export type AutoScoreResult = {
  score: number;
  max: number;
  signals: string[];
  reason: string;
};

export type QuestionTypeDef = {
  type: QuestionType;
  /** Validates the `interactive_config` column. Pass `null` for types without config. */
  configSchema: z.ZodSchema<unknown>;
  /** Validates the `structured_answer` column. */
  answerSchema: z.ZodSchema<unknown>;
  /**
   * Deterministic scorer. Returns null when the type requires AI scoring
   * (open, voice, file) — the caller queues an AI score job instead.
   */
  autoScore?: (args: {
    config: unknown;
    answer: unknown;
    points: number;
  }) => AutoScoreResult | null;
  /** Short label rendered in admin question-bank UI. */
  label: string;
};
