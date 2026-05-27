import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Scenario builder — multi-step choose-your-path with a final rationale.
 *
 * config:
 *   steps[]: { id, prompt, choices: [{id, label, is_correct, score_weight}] }
 *   require_rationale: boolean
 *
 * answer:
 *   steps[]: { step_id, choice_id }
 *   rationale_text? (if require_rationale)
 *
 * scoring: deterministic on choices (sum of score_weights for correct
 * picks, scaled to points). Rationale text scored by AI separately.
 */
export const scenarioTypeDef: QuestionTypeDef = {
  type: "scenario",
  label: "Scenario builder",
  configSchema: z.object({
    steps: z
      .array(
        z.object({
          id: z.string().min(1).max(40),
          prompt: z.string().min(1).max(2000),
          choices: z
            .array(
              z.object({
                id: z.string().min(1).max(40),
                label: z.string().min(1).max(400),
                is_correct: z.boolean(),
                score_weight: z.number().min(0).max(10).default(1),
              }),
            )
            .min(2)
            .max(6),
        }),
      )
      .min(1)
      .max(10),
    require_rationale: z.boolean().default(false),
  }),
  answerSchema: z.object({
    steps: z
      .array(
        z.object({
          step_id: z.string().min(1).max(40),
          choice_id: z.string().min(1).max(40),
        }),
      )
      .min(1)
      .max(10),
    rationale_text: z.string().max(4000).optional(),
  }),
  autoScore: ({ config, answer, points }) => {
    const c = config as {
      steps: Array<{
        id: string;
        choices: Array<{ id: string; is_correct: boolean; score_weight: number }>;
      }>;
      require_rationale: boolean;
    };
    const a = answer as {
      steps: Array<{ step_id: string; choice_id: string }>;
      rationale_text?: string;
    };

    let weightEarned = 0;
    let weightTotal = 0;
    for (const step of c.steps) {
      const submitted = a.steps.find((s) => s.step_id === step.id);
      const correctChoice = step.choices.find((ch) => ch.is_correct);
      const maxWeight = Math.max(...step.choices.map((ch) => ch.score_weight));
      weightTotal += maxWeight;
      if (!submitted || !correctChoice) continue;
      const picked = step.choices.find((ch) => ch.id === submitted.choice_id);
      if (picked?.is_correct) {
        weightEarned += picked.score_weight;
      }
    }

    const ratio = weightTotal === 0 ? 0 : weightEarned / weightTotal;
    const choicesScore = Math.round(points * ratio);

    // Rationale text (if required) is AI-scored separately. We return
    // the deterministic choice-score here; the AI pipeline adds on
    // top per the scoring layer.
    return {
      score: choicesScore,
      max: points,
      signals: [
        `choices_correct:${weightEarned.toFixed(1)}/${weightTotal.toFixed(1)}`,
        c.require_rationale && a.rationale_text
          ? "rationale_provided"
          : "rationale_missing",
      ],
      reason: `Choice weight ${weightEarned.toFixed(1)} of ${weightTotal.toFixed(1)} (${choicesScore}/${points}). ${
        c.require_rationale ? "Rationale text scored separately by AI." : ""
      }`,
    };
  },
};
