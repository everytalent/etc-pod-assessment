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

export const submitAnswerSchema = z.object({
  question_id: z.string().uuid(),
  /**
   * Option ids as defined on `questions.options[].id`. For MCQ this will be a
   * single id; multi-select reserved for later but the shape is already
   * array-of-string.
   */
  selected_options: z.array(z.string().min(1).max(40)).max(20),
  /** Client-reported elapsed seconds. Server cross-checks (PRD §5.2). */
  time_spent_seconds: z.number().int().nonnegative().max(60 * 60),
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
    | "formula";
  questionText: string;
  options: { id: string; label: string }[];
  points: number;
  negativePoints: number;
  timerEnabled: boolean;
  timeLimitSeconds: number | null;
  timeoutAction: "auto_submit" | "skip" | "mark_incorrect";
  required: boolean;
  section: string | null;
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
