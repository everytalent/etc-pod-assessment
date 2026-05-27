import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Slider / numeric input. "Size the battery for this load profile."
 *
 * config:
 *   min, max, step, unit
 *   target_value + abs_tolerance OR pct_tolerance
 *   partial_credit?: 'linear_off_target' (default 0/all)
 *
 * answer:
 *   value, unit
 */
export const sliderTypeDef: QuestionTypeDef = {
  type: "slider",
  label: "Slider / numeric",
  configSchema: z
    .object({
      min: z.number(),
      max: z.number(),
      step: z.number().min(0.0001).max(1_000_000),
      unit: z.string().min(1).max(20),
      target_value: z.number(),
      abs_tolerance: z.number().min(0).optional(),
      pct_tolerance: z.number().min(0).max(100).optional(),
      partial_credit: z.enum(["none", "linear_off_target"]).default("none"),
    })
    .refine(
      (v) => v.abs_tolerance !== undefined || v.pct_tolerance !== undefined,
      { message: "One of abs_tolerance or pct_tolerance is required" },
    ),
  answerSchema: z.object({
    value: z.number(),
    unit: z.string().min(1).max(20),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      target_value: number;
      unit: string;
      abs_tolerance?: number;
      pct_tolerance?: number;
      partial_credit: "none" | "linear_off_target";
    };
    const a = answer as { value: number; unit: string };

    if (a.unit !== c.unit) {
      return {
        score: 0,
        max: points,
        signals: ["unit_mismatch"],
        reason: `Expected unit ${c.unit}, got ${a.unit}.`,
      };
    }

    const diff = Math.abs(a.value - c.target_value);
    const absTol = c.abs_tolerance ?? Infinity;
    const pctTol = c.pct_tolerance
      ? (Math.abs(c.target_value) * c.pct_tolerance) / 100
      : Infinity;
    const tol = Math.min(absTol, pctTol);

    if (diff <= tol) {
      return {
        score: points,
        max: points,
        signals: ["within_tolerance"],
        reason: `Within ±${tol.toFixed(2)} of ${c.target_value}.`,
      };
    }

    if (c.partial_credit === "linear_off_target") {
      // Linear falloff: full credit at exact, zero credit at 2× tolerance.
      const scale = Math.max(0, 1 - (diff - tol) / tol);
      const earned = Math.round(points * scale);
      return {
        score: earned,
        max: points,
        signals: ["partial_off_target"],
        reason: `Off by ${diff.toFixed(2)} (tol ${tol.toFixed(2)}); ${earned}/${points} partial credit.`,
      };
    }

    return {
      score: 0,
      max: points,
      signals: ["out_of_tolerance"],
      reason: `Off by ${diff.toFixed(2)}; tolerance was ${tol.toFixed(2)}.`,
    };
  },
};
