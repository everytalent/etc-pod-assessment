import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Drag-and-drop sequence. "Order the installation steps correctly."
 *
 * config:
 *   items[]: { id, label } (the steps in PRESENTATION order — shuffled by client)
 *   correct_sequence[]: ids in the canonical correct order
 *   scoring: 'exact' | 'kendall' (kendall = partial credit by inversion count)
 *
 * answer:
 *   sequence: ordered list of item ids the candidate produced
 */
export const sequenceTypeDef: QuestionTypeDef = {
  type: "sequence",
  label: "Drag-and-drop sequence",
  configSchema: z.object({
    items: z
      .array(z.object({ id: z.string().min(1).max(40), label: z.string().max(200) }))
      .min(2)
      .max(20),
    correct_sequence: z.array(z.string().min(1).max(40)).min(2).max(20),
    scoring: z.enum(["exact", "kendall"]).default("exact"),
  }),
  answerSchema: z.object({
    sequence: z.array(z.string().min(1).max(40)).min(1).max(20),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      correct_sequence: string[];
      scoring: "exact" | "kendall";
    };
    const a = answer as { sequence: string[] };

    if (a.sequence.length !== c.correct_sequence.length) {
      return {
        score: 0,
        max: points,
        signals: ["wrong_length"],
        reason: `Submitted ${a.sequence.length} items, expected ${c.correct_sequence.length}.`,
      };
    }

    if (c.scoring === "exact") {
      const allMatch = a.sequence.every((id, i) => id === c.correct_sequence[i]);
      return {
        score: allMatch ? points : 0,
        max: points,
        signals: [allMatch ? "exact_match" : "wrong_order"],
        reason: allMatch ? "Sequence matches exactly." : "At least one item out of order.",
      };
    }

    // Kendall tau distance — count inversions, scale to points.
    const positionInCorrect = new Map<string, number>();
    c.correct_sequence.forEach((id, i) => positionInCorrect.set(id, i));
    let inversions = 0;
    let maxInversions = 0;
    const n = a.sequence.length;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        maxInversions += 1;
        const pi = positionInCorrect.get(a.sequence[i]);
        const pj = positionInCorrect.get(a.sequence[j]);
        if (pi === undefined || pj === undefined) {
          inversions += 1; // unknown item counts as inverted
          continue;
        }
        if (pi > pj) inversions += 1;
      }
    }
    const ratio = maxInversions === 0 ? 1 : 1 - inversions / maxInversions;
    const earned = Math.round(points * ratio);
    return {
      score: earned,
      max: points,
      signals: [`kendall:${ratio.toFixed(2)}`],
      reason: `Kendall tau ratio ${ratio.toFixed(2)} (${inversions} of ${maxInversions} pair inversions).`,
    };
  },
};
