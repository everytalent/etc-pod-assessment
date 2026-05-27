/**
 * Zod input validators for the candidate API routes — PRD §5.1, §5.4.
 *
 * One schema per route surface; routes import the schema and `z.infer` the
 * input type. The output shapes are typed below as plain TS interfaces
 * (Zod isn't doing anything for output — TS inference is enough).
 */

import { z } from "zod";

/* ---------- POST /api/sessions ---------- */

export const startSessionSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "slug must be lower-kebab"),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  // Phone is optional in the PRD's data model (candidate_phone is nullable).
  phone: z
    .string()
    .trim()
    .min(5)
    .max(40)
    .optional(),
});
export type StartSessionInput = z.infer<typeof startSessionSchema>;

/* ---------- POST /api/answers ---------- */

export const submitAnswerSchema = z
  .object({
    question_id: z.string().uuid(),
    /**
     * Option ids for MCQ / multi_select / true_false. Empty for open-ended.
     */
    selected_options: z.array(z.string().min(1).max(40)).max(20).default([]),
    /** Client-reported elapsed seconds. Server cross-checks (PRD §5.2). */
    time_spent_seconds: z.number().int().nonnegative().max(60 * 60),
    /** Open-ended text answer (when candidate chose "type instead"). */
    text_response: z.string().trim().min(1).max(8000).optional(),
    /**
     * Open-ended voice answer — Storage path returned by
     * /api/answers/voice/upload-url after the candidate's browser uploads
     * the audio blob.
     */
    audio_path: z.string().min(1).max(200).optional(),
    audio_duration_seconds: z
      .number()
      .int()
      .min(0)
      .max(60 * 10)
      .optional(),
    /**
     * Timeout-only signal: the candidate was actively recording (or typing
     * below the 20-char minimum) when the timer ran out, but we couldn't
     * recover usable input. Set by the client's auto-submit-on-timeout path.
     */
    recording_attempted: z.boolean().optional(),
    /**
     * Structured payload for interactive types (slider, hotspot, sequence,
     * matching, scenario, formula). Schema-validated server-side per
     * question type via the type registry.
     */
    structured_answer: z.unknown().optional(),
  })
  .superRefine((val, ctx) => {
    // Open-ended payload sanity: at most one of text/audio.
    if (val.text_response && val.audio_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text_response"],
        message: "Send either text_response or audio_path, not both.",
      });
    }
  });
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;

/* ---------- Output shapes ---------- */

/**
 * Public projection of a question — what a candidate is allowed to see.
 * NEVER includes `correctAnswer`.
 */
export type CandidateQuestion = {
  id: string;
  type:
    | "mcq"
    | "true_false"
    | "open"
    | "voice"
    | "file"
    | "formula"
    // Talent Validation Engine extensions (Phase 2):
    | "hotspot"
    | "sequence"
    | "slider"
    | "matching"
    | "scenario";
  questionText: string;
  options: { id: string; label: string }[];
  points: number;
  negativePoints: number;
  timerEnabled: boolean;
  timeLimitSeconds: number | null;
  timeoutAction: "auto_submit" | "skip" | "mark_incorrect";
  required: boolean;
  section: string | null;
  /**
   * Type-specific config for interactive types (slider range/tolerance,
   * hotspot regions, sequence items, matching pairs, scenario tree).
   * Null for non-interactive types (mcq/true_false/open/voice/file/formula).
   * Validated client-side by the type's component using the schema in
   * lib/engines/assessment/question-types/.
   */
  interactiveConfig: unknown;
};

export type StartSessionResponse = {
  response_id: string;
  next_question: CandidateQuestion | null;
  is_complete: boolean;
};

export type AnswerResponse = {
  score_so_far: number;
  next_question: CandidateQuestion | null;
  is_complete: boolean;
};

export type CurrentSessionResponse = {
  response_id: string;
  assessment_slug: string;
  next_question: CandidateQuestion | null;
  score_so_far: number;
  is_complete: boolean;
} | null;

export type FinalizeResponse = {
  total_score: number;
  max_possible_score: number;
  pass: boolean;
};
