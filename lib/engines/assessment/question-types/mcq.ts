import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * MCQ — single correct option. Uses the existing `questions.options`
 * and `correctAnswer` columns, NOT interactive_config; structured
 * answer is the existing `selectedOptions` column. This def exists so
 * the question-type registry is exhaustive.
 */
export const mcqTypeDef: QuestionTypeDef = {
  type: "mcq",
  label: "Multiple choice",
  configSchema: z.null(),
  answerSchema: z.object({
    selected_option_id: z.string().min(1).max(40),
  }),
  autoScore: () => null, // scored by existing scoreAnswer() in lib/assessment/scoring.ts
};
