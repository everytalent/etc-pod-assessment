/**
 * Drizzle schema — source of truth: PRD §3.
 *
 * Tables: assessments, questions, branching_rules, responses, answers.
 * Index: (response_id, question_id) on answers (PRD §9).
 *
 * RLS: not declared here; enabled and policied in /api when session tokens
 * exist. The seed script and server runtime use the service-role key.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/* ---------- Enums ---------- */

export const roleTypeEnum = pgEnum("role_type", ["tech", "bd"]);
export const assessmentStatusEnum = pgEnum("assessment_status", [
  "draft",
  "published",
  "archived",
]);
/**
 * Assessment visibility — controls whether the assessment surfaces on the
 * candidate-facing public listing page.
 *
 *   listed   — visible on assess.energytalentco.com when status='published'.
 *   unlisted — accessible only via direct link; never appears on listings.
 *
 * Independent from `status`: a draft can be unlisted (it's not published
 * either way) but visibility only matters once status='published'.
 */
export const assessmentVisibilityEnum = pgEnum("assessment_visibility", [
  "listed",
  "unlisted",
]);
export const questionTypeEnum = pgEnum("question_type", [
  "mcq",
  "true_false",
  "open",
  "voice",
  "file",
  "formula",
]);
export const timeoutActionEnum = pgEnum("timeout_action", [
  "auto_submit",
  "skip",
  "mark_incorrect",
]);
export const responseStatusEnum = pgEnum("response_status", [
  "in_progress",
  "submitted",
  "abandoned",
]);
/**
 * Admin role tiers (least → most privileged on user management):
 *   assessor   — read responses + score open-ended only.
 *   editor     — assessor + author/edit assessments + export + archive.
 *   admin      — editor + invite/remove editor & assessor users.
 *   superadmin — admin + invite/remove any role (incl. other supers).
 */
export const adminRoleEnum = pgEnum("admin_role", [
  "superadmin",
  "admin",
  "editor",
  "assessor",
]);

/* ---------- jsonb shapes ---------- */

export type QuestionOption = { id: string; label: string };

/** Per PRD §5.3 — operators supported in v1. */
export type RuleCondition =
  | { op: "score_gte"; value: number }
  | { op: "score_lte"; value: number }
  | { op: "answer_equals"; value: string }
  | { op: "answer_in"; value: string[] }
  | { op: "section_score_gte"; section: string; value: number };

/** Per PRD §5.3 — actions supported in v1. */
export type RuleAction =
  | { type: "jump_to"; target_question_id: string }
  | { type: "skip_to_end" }
  | { type: "skip_section"; section: string };

export type ResponseMetadata = {
  user_agent?: string;
  ip_hash?: string;
  /** Ordered list of question ids actually traversed (PRD §5.3). */
  path?: string[];
  time_on_task_seconds?: number;
  /**
   * ISO timestamp of when the current question was shown to the candidate,
   * used by /api/answers to compute the server-side time-spent delta and
   * cross-check the client-reported value (PRD §5.2).
   */
  last_question_shown_at?: string;
  /** Set true on responses started from admin preview mode (PRD §5.5). */
  preview?: boolean;
};

/* ---------- Tables ---------- */

export const assessments = pgTable("assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  roleType: roleTypeEnum("role_type").notNull(),
  status: assessmentStatusEnum("status").notNull().default("draft"),
  visibility: assessmentVisibilityEnum("visibility")
    .notNull()
    .default("listed"),
  passThreshold: integer("pass_threshold").notNull().default(70),
  introText: text("intro_text").notNull().default(""),
  outroText: text("outro_text").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    type: questionTypeEnum("type").notNull().default("mcq"),
    questionText: text("question_text").notNull(),
    options: jsonb("options").$type<QuestionOption[]>().notNull().default([]),
    correctAnswer: jsonb("correct_answer").$type<string[]>().notNull().default([]),
    points: integer("points").notNull().default(1),
    negativePoints: integer("negative_points").notNull().default(0),
    timerEnabled: boolean("timer_enabled").notNull().default(false),
    timeLimitSeconds: integer("time_limit_seconds"),
    timeoutAction: timeoutActionEnum("timeout_action")
      .notNull()
      .default("auto_submit"),
    required: boolean("required").notNull().default(true),
    section: text("section"),
  },
  (t) => [index("questions_assessment_id_idx").on(t.assessmentId)],
);

export const branchingRules = pgTable(
  "branching_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    fromQuestionId: uuid("from_question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    condition: jsonb("condition").$type<RuleCondition>().notNull(),
    action: jsonb("action").$type<RuleAction>().notNull(),
    priority: integer("priority").notNull().default(0),
  },
  (t) => [index("branching_rules_from_question_idx").on(t.fromQuestionId)],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    candidateName: text("candidate_name").notNull(),
    candidateEmail: text("candidate_email").notNull(),
    candidatePhone: text("candidate_phone"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    totalScore: integer("total_score"),
    /** Snapshot at submit time (PRD §3). */
    maxPossibleScore: integer("max_possible_score").notNull().default(0),
    status: responseStatusEnum("status").notNull().default("in_progress"),
    pass: boolean("pass"),
    metadata: jsonb("metadata")
      .$type<ResponseMetadata>()
      .notNull()
      .default({}),
  },
  (t) => [index("responses_assessment_id_idx").on(t.assessmentId)],
);

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => responses.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    selectedOptions: jsonb("selected_options")
      .$type<string[]>()
      .notNull()
      .default([]),
    /**
     * For type='open': the candidate's typed answer when they chose the
     * text path instead of voice. Mutually exclusive with audio_path
     * (only one of the two is populated per answer).
     */
    textResponse: text("text_response"),
    /**
     * For type='open': the Supabase Storage object path of the uploaded
     * audio. Format: voice-responses/<response_id>/<question_id>.webm.
     * Resolved to a short-lived signed URL when admins play it back.
     */
    audioPath: text("audio_path"),
    /** Recorded duration in seconds (so admin UI can show length without fetching). */
    audioDurationSeconds: integer("audio_duration_seconds"),
    /**
     * AI-generated transcript of the voice answer (Gemini 2.0 Flash, on
     * demand from the response drill-in). Null until an admin clicks
     * "Transcribe" — we don't auto-transcribe at submit time because
     * (a) it costs API quota for answers no one will review, and (b)
     * voice answers may be archived to Zoho before review, so deferring
     * lets us no-op gracefully when the source audio is gone.
     */
    transcript: text("transcript"),
    /**
     * Open-ended answers can't auto-score — they need a human reviewer.
     * scored_by is the admin_users.id who entered a score; null = unscored.
     */
    scoredBy: uuid("scored_by"),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    timedOut: boolean("timed_out").notNull().default(false),
    scoreAwarded: integer("score_awarded").notNull().default(0),
    answeredAt: timestamp("answered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // PRD §9: index on (response_id, question_id) for hot answer lookups.
  (t) => [index("answers_response_question_idx").on(t.responseId, t.questionId)],
);

/* ---------- Relations ---------- */

export const assessmentsRelations = relations(assessments, ({ many }) => ({
  questions: many(questions),
  branchingRules: many(branchingRules),
  responses: many(responses),
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
  assessment: one(assessments, {
    fields: [questions.assessmentId],
    references: [assessments.id],
  }),
  branchingRules: many(branchingRules),
  answers: many(answers),
}));

export const branchingRulesRelations = relations(branchingRules, ({ one }) => ({
  assessment: one(assessments, {
    fields: [branchingRules.assessmentId],
    references: [assessments.id],
  }),
  fromQuestion: one(questions, {
    fields: [branchingRules.fromQuestionId],
    references: [questions.id],
  }),
}));

export const responsesRelations = relations(responses, ({ one, many }) => ({
  assessment: one(assessments, {
    fields: [responses.assessmentId],
    references: [assessments.id],
  }),
  answers: many(answers),
}));

export const answersRelations = relations(answers, ({ one }) => ({
  response: one(responses, {
    fields: [answers.responseId],
    references: [responses.id],
  }),
  question: one(questions, {
    fields: [answers.questionId],
    references: [questions.id],
  }),
}));

/**
 * admin_users — allowlist of emails that may sign in to /admin.
 *
 * Bootstrap row: ugo@energytalentco.com with role='superadmin'.
 * Anyone not in this table is rejected at /admin/auth-callback (signed out
 * + redirected to /admin/login?error=not_authorized).
 *
 * Only `superadmin` rows can invite or remove other admin_users.
 */
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: adminRoleEnum("role").notNull().default("admin"),
  // Self-FK: who invited them. Nullable so the bootstrap row has no inviter.
  invitedBy: uuid("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ---------- Inferred row types (use these in app code) ---------- */

export type Assessment = typeof assessments.$inferSelect;
export type NewAssessment = typeof assessments.$inferInsert;
export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type BranchingRule = typeof branchingRules.$inferSelect;
export type NewBranchingRule = typeof branchingRules.$inferInsert;
export type Response = typeof responses.$inferSelect;
export type NewResponse = typeof responses.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
