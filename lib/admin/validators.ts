/**
 * Admin-side Zod validators. Server-truth shapes for the builder forms +
 * admin API routes. The admin client uses these for both submission and
 * RHF schema parity, so a UI validation pass guarantees the server payload
 * is well-formed.
 */

import { z } from "zod";

const slugRegex = /^[a-z0-9-]+$/;
const idArray = z.array(z.string().min(1).max(64)).max(40);

const optionSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(280),
});

/* ---------- Assessments ---------- */

export const upsertAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(slugRegex, "lower-kebab only"),
  roleType: z.enum(["tech", "bd"]),
  status: z.enum(["draft", "published", "archived"]),
  passThreshold: z.number().int().min(0).max(100),
  // Required strings (empty allowed). RHF supplies "" via defaultValues —
  // we don't use .default(...) here because it makes the input type optional
  // and breaks RHF's strict resolver typing.
  introText: z.string().max(2000),
  outroText: z.string().max(2000),
});
export type UpsertAssessmentInput = z.infer<typeof upsertAssessmentSchema>;

/* ---------- Questions ---------- */

export const upsertQuestionSchema = z
  .object({
    type: z.enum(["mcq", "true_false", "open", "voice", "file", "formula"]),
    questionText: z.string().trim().min(1).max(2000),
    // Required arrays (empty allowed). Defaults supplied at the form layer.
    options: z.array(optionSchema).max(20),
    correctAnswer: idArray,
    points: z.number().int().min(0).max(100),
    negativePoints: z.number().int().min(0).max(100),
    timerEnabled: z.boolean(),
    timeLimitSeconds: z.number().int().min(1).max(60 * 60).nullable(),
    timeoutAction: z.enum(["auto_submit", "skip", "mark_incorrect"]),
    required: z.boolean(),
    section: z.string().trim().max(80).nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.timerEnabled && val.timeLimitSeconds === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timeLimitSeconds"],
        message: "time_limit_seconds is required when timer_enabled is true",
      });
    }
    if ((val.type === "mcq" || val.type === "true_false")) {
      if (val.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ needs at least 2 options",
        });
      }
      if (val.correctAnswer.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["correctAnswer"],
          message: "Pick at least one correct option",
        });
      }
      const optionIds = new Set(val.options.map((o) => o.id));
      for (const id of val.correctAnswer) {
        if (!optionIds.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["correctAnswer"],
            message: `correct_answer references unknown option id: ${id}`,
          });
        }
      }
    }
  });
export type UpsertQuestionInput = z.infer<typeof upsertQuestionSchema>;

export const reorderQuestionsSchema = z.object({
  assessmentId: z.string().uuid(),
  /** Question ids in their new order. */
  orderedIds: z.array(z.string().uuid()).min(1),
});
export type ReorderQuestionsInput = z.infer<typeof reorderQuestionsSchema>;

/* ---------- Branching rules ---------- */

const ruleConditionSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("score_gte"), value: z.number() }),
  z.object({ op: z.literal("score_lte"), value: z.number() }),
  z.object({ op: z.literal("answer_equals"), value: z.string().min(1) }),
  z.object({ op: z.literal("answer_in"), value: z.array(z.string()).min(1) }),
  z.object({
    op: z.literal("section_score_gte"),
    section: z.string().min(1),
    value: z.number(),
  }),
]);

const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("jump_to"), target_question_id: z.string().uuid() }),
  z.object({ type: z.literal("skip_to_end") }),
  z.object({ type: z.literal("skip_section"), section: z.string().min(1) }),
]);

export const upsertBranchingRuleSchema = z.object({
  assessmentId: z.string().uuid(),
  fromQuestionId: z.string().uuid(),
  condition: ruleConditionSchema,
  action: ruleActionSchema,
  priority: z.number().int().min(0).max(1000),
});
export type UpsertBranchingRuleInput = z.infer<typeof upsertBranchingRuleSchema>;
