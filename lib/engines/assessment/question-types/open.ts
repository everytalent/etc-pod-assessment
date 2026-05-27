import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Open-ended text answer. AI-scored (Gemini + Kimi via rubric).
 * The existing `answers.text_response` column holds the response.
 */
export const openTypeDef: QuestionTypeDef = {
  type: "open",
  label: "Open-ended (text)",
  configSchema: z.null(),
  answerSchema: z.object({
    text: z.string().trim().min(20).max(8000),
  }),
  // No deterministic scorer — AI scoring is required.
  autoScore: () => null,
};
