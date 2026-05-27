import { z } from "zod";

import type { QuestionTypeDef } from "./types";

export const trueFalseTypeDef: QuestionTypeDef = {
  type: "true_false",
  label: "True / False",
  configSchema: z.null(),
  answerSchema: z.object({ value: z.boolean() }),
  autoScore: () => null, // scored by existing scoreAnswer()
};
