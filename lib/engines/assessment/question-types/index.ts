/**
 * Question type framework — one entry per question_type enum value.
 *
 * Each type defines:
 *   - configSchema: validates the `interactive_config` jsonb (admin
 *     authoring side — e.g. hotspot regions, slider range)
 *   - answerSchema: validates the `structured_answer` jsonb (candidate
 *     submit side — e.g. click coords, slider value)
 *   - autoScore?: pure function (config, answer, question) → { score,
 *     max, signals, reason } | null. null = AI scoring required
 *
 * PRD §5 principle: push as much scoring to deterministic auto-eval
 * as possible. AI is only invoked when natural-language reasoning is
 * needed (open, voice, scenario rationale, formula working).
 *
 * Importers: API routes use `getTypeDef(question.type)` to dispatch
 * by type. Candidate UI imports the right AnswerInput component via
 * `<AnswerInput question={...}>` (lives in components/, references
 * these schemas).
 */

import type { QuestionType } from "./types";
import { hotspotTypeDef } from "./hotspot";
import { matchingTypeDef } from "./matching";
import { mcqTypeDef } from "./mcq";
import { openTypeDef } from "./open";
import { scenarioTypeDef } from "./scenario";
import { sequenceTypeDef } from "./sequence";
import { sliderTypeDef } from "./slider";
import { trueFalseTypeDef } from "./true-false";
import { voiceTypeDef } from "./voice";
import { fileTypeDef } from "./file";
import { formulaTypeDef } from "./formula";
import type { QuestionTypeDef } from "./types";

const REGISTRY: Record<QuestionType, QuestionTypeDef> = {
  mcq: mcqTypeDef,
  true_false: trueFalseTypeDef,
  open: openTypeDef,
  voice: voiceTypeDef,
  file: fileTypeDef,
  formula: formulaTypeDef,
  hotspot: hotspotTypeDef,
  sequence: sequenceTypeDef,
  slider: sliderTypeDef,
  matching: matchingTypeDef,
  scenario: scenarioTypeDef,
};

export function getTypeDef(type: QuestionType): QuestionTypeDef {
  const def = REGISTRY[type];
  if (!def) {
    throw new Error(`Unknown question type: ${type}`);
  }
  return def;
}

export type { QuestionType, QuestionTypeDef, AutoScoreResult } from "./types";
