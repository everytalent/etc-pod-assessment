import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Numeric / formula answer. Deterministic check against a target value
 * with a tolerance band; optional working text scored by AI separately.
 *
 * config:
 *   target_value, unit, abs_tolerance OR pct_tolerance (one of)
 *
 * answer:
 *   value, unit (must match config.unit), working? (optional explanation)
 */
export const formulaTypeDef: QuestionTypeDef = {
  type: "formula",
  label: "Formula / calculation",
  configSchema: z
    .object({
      target_value: z.number(),
      unit: z.string().min(1).max(20),
      abs_tolerance: z.number().min(0).optional(),
      pct_tolerance: z.number().min(0).max(100).optional(),
    })
    .refine(
      (v) => v.abs_tolerance !== undefined || v.pct_tolerance !== undefined,
      { message: "One of abs_tolerance or pct_tolerance is required" },
    ),
  answerSchema: z.object({
    value: z.number(),
    unit: z.string().min(1).max(20),
    working: z.string().max(4000).optional(),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      target_value: number;
      unit: string;
      abs_tolerance?: number;
      pct_tolerance?: number;
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
        reason: `Answer ${a.value} ${a.unit} is within ${tol.toFixed(2)} of ${c.target_value} ${c.unit}.`,
      };
    }
    return {
      score: 0,
      max: points,
      signals: ["out_of_tolerance"],
      reason: `Answer ${a.value} ${a.unit} differs from ${c.target_value} by ${diff.toFixed(2)} (tol ${tol.toFixed(2)}).`,
    };
  },
};
