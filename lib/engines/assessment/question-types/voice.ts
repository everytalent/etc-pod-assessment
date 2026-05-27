import { z } from "zod";

import type { QuestionTypeDef } from "./types";

/**
 * Voice answer. Existing `audio_path` + new `translated_transcript`
 * columns. AI-scored after transcription + (optional) translation.
 */
export const voiceTypeDef: QuestionTypeDef = {
  type: "voice",
  label: "Voice answer",
  configSchema: z.null(),
  answerSchema: z.object({
    audio_path: z.string().min(1).max(200),
    duration_seconds: z.number().int().min(0).max(600),
  }),
  autoScore: () => null,
};
