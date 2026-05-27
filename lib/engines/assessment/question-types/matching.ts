import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Matching — pair LHS items to RHS items. "Match each fault symptom
 * to its likely cause."
 *
 * config:
 *   lhs[]: { id, label }
 *   rhs[]: { id, label }
 *   correct_pairs: [[lhsId, rhsId], ...]
 *   scoring: 'all_or_nothing' | 'per_pair'
 *
 * answer:
 *   pairs: [[lhsId, rhsId], ...] — candidate's mapping
 */
export const matchingTypeDef: QuestionTypeDef = {
  type: "matching",
  label: "Matching pairs",
  configSchema: z.object({
    lhs: z
      .array(z.object({ id: z.string().min(1).max(40), label: z.string().max(200) }))
      .min(2)
      .max(15),
    rhs: z
      .array(z.object({ id: z.string().min(1).max(40), label: z.string().max(200) }))
      .min(2)
      .max(15),
    correct_pairs: z
      .array(z.tuple([z.string().min(1).max(40), z.string().min(1).max(40)]))
      .min(1)
      .max(15),
    scoring: z.enum(["all_or_nothing", "per_pair"]).default("per_pair"),
  }),
  answerSchema: z.object({
    pairs: z
      .array(z.tuple([z.string().min(1).max(40), z.string().min(1).max(40)]))
      .max(15),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      correct_pairs: [string, string][];
      scoring: "all_or_nothing" | "per_pair";
    };
    const a = answer as { pairs: [string, string][] };

    const correctSet = new Set(c.correct_pairs.map(([l, r]) => `${l}|${r}`));
    const submittedSet = new Set(a.pairs.map(([l, r]) => `${l}|${r}`));

    let correct = 0;
    for (const key of submittedSet) {
      if (correctSet.has(key)) correct += 1;
    }
    const total = c.correct_pairs.length;

    if (c.scoring === "all_or_nothing") {
      const allMatch = correct === total && submittedSet.size === total;
      return {
        score: allMatch ? points : 0,
        max: points,
        signals: [allMatch ? "all_pairs_correct" : "some_pairs_wrong"],
        reason: `${correct} of ${total} pairs correct (all-or-nothing).`,
      };
    }

    const ratio = total === 0 ? 0 : correct / total;
    const earned = Math.round(points * ratio);
    return {
      score: earned,
      max: points,
      signals: [`per_pair:${correct}/${total}`],
      reason: `${correct} of ${total} pairs correct (per-pair scoring → ${earned}/${points}).`,
    };
  },
};
