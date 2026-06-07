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
  unique,
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
  // Talent Validation Engine extensions (PRD §5).
  "hotspot",
  "sequence",
  "slider",
  "matching",
  "scenario",
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
 * Where the live answer score came from. 'manual' = an admin typed and
 * saved a number; 'ai_gemini' / 'ai_kimi' = an admin accepted that AI's
 * suggestion. Lets the drill-in show "Score accepted from 1st assessor
 * by Ugo" rather than treating every save the same.
 */
export const scoreSourceEnum = pgEnum("score_source", [
  "manual",
  "ai_gemini",
  "ai_kimi",
]);

/**
 * Outcome of the dual-AI cross-check pipeline.
 *
 *   pending      — pipeline hasn't run yet
 *   gemini_only  — Gemini scored every answer, Kimi spot-check pending
 *   agree        — Kimi spot-checked a sample; mean abs diff ≤ threshold;
 *                  Gemini's scores stand as the AI suggestion of record
 *   override     — Kimi disagreed with the sample → Kimi rescored
 *                  everything; Kimi's scores are now primary
 */
export const aiConsensusEnum = pgEnum("ai_consensus", [
  "pending",
  "gemini_only",
  "agree",
  "override",
]);

/**
 * Per-answer cheating-risk tag, applied on top of the raw score:
 *   low   — flagged but no penalty; "we noticed but it looks fine"
 *   mid   — strong concern; answer's contribution to the total is zeroed
 *   high  — clear concern; -1 point on this answer's contribution
 * Set by a human reviewer (default) or proposed by Kimi (Phase 5); the
 * source column on `answers` tracks who/what set the current value.
 */
export const integrityLevelEnum = pgEnum("integrity_level", [
  "low",
  "mid",
  "high",
]);
export const integritySourceEnum = pgEnum("integrity_source", [
  "manual",
  "ai_kimi",
  "ai_gemini",
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

/* ---------- Talent Validation Engine enums (PRD 2026-05-11) ---------- */

/**
 * `fixed` = the V1 "Project assessment" flow (hand-authored questions on
 * the assessments row). `validation` = the adaptive CAT flow that pulls
 * from the question bank anchored by `(specialisation, band, level)`.
 * Existing rows default to `fixed` — V1 keeps working unchanged.
 */
export const assessmentModeEnum = pgEnum("assessment_mode", [
  "fixed",
  "validation",
]);

/**
 * Recruiter-facing seniority band. Three coarse buckets that companies
 * actually hire against. The (band, level) tuple is the primary
 * categorisation unit produced by the Validation Engine.
 */
export const seniorityBandEnum = pgEnum("seniority_band", [
  "junior",
  "mid",
  "senior",
]);

/**
 * Performance level within a band — calibrated to ETC's existing
 * skillboard rubric language.
 *   below — Below Standard
 *   nh    — New Hire (Day 14)
 *   g     — Growing (Day 30)
 *   p     — Pro (Day 60)
 *   tp    — Top Performer (Promotion)
 */
export const performanceLevelEnum = pgEnum("performance_level", [
  "below",
  "nh",
  "g",
  "p",
  "tp",
]);

/**
 * Learner-facing progression cadre (mirrors podsproject migration 010).
 * Derived from (band, level) by `lib/engines/assessment/cadre-deriver.ts`
 * so learners see their own progression in language designed for them
 * while recruiters read the band. See memory/cadre-vs-band.md.
 *   el   — Entry-Level
 *   int  — Intermediate
 *   expd — Expanded
 *   adv  — Advanced
 *   expt — Expert
 */
export const cadreEnum = pgEnum("cadre", ["el", "int", "expd", "adv", "expt"]);

/** Lifecycle of a validation-mode response. */
export const validationStatusEnum = pgEnum("validation_status", [
  "pending",
  "scored",
  "human_review",
  "finalised",
]);

/** Final hiring recommendation produced by Kimi synthesis. */
export const hireRecommendationEnum = pgEnum("hire_recommendation", [
  "hire",
  "no_hire",
  "borderline",
  "requires_human_review",
]);

/**
 * Whether a Vetted Talent Profile value was last set by AI or by a human
 * override. Used to drive the audit trail and the "AI vs human" diff
 * view in the drill-in.
 */
export const finalSourceEnum = pgEnum("final_source", ["ai", "human_override"]);

/** Authoring path on a new skillboard. */
export const skillboardCreationPathEnum = pgEnum("skillboard_creation_path", [
  "upload",
  "claude_authored",
]);

/** Per-cell approval state on level_expectations. */
export const approvalStateEnum = pgEnum("approval_state", [
  "pending",
  "approved",
  "rejected",
]);

/** Translation pipeline lifecycle on each answer. */
export const translationStatusEnum = pgEnum("translation_status", [
  "not_needed",
  "pending",
  "done",
  "failed",
]);

/**
 * Models the assessment engine pays for. Tracked per-call in
 * `ai_spend_ledger` so each engine has its own monthly cap per the
 * architecture principle ("each engine has its own monthly spend ledger
 * if it uses paid AI services").
 */
export const aiSpendModelEnum = pgEnum("ai_spend_model", [
  "opus",
  "gemini_pro",
  "gemini_flash",
  "kimi",
]);

/** What an AI call was being used for. Drives per-purpose dashboard. */
export const aiSpendPurposeEnum = pgEnum("ai_spend_purpose", [
  "question_seed",
  "weekly_refresh",
  "synthesis",
  "scoring",
  "translation",
  "transcription",
  "below_standard_synthesis",
  "band_extension_synthesis",
  "learning_summary",
  "skillboard_authoring",
  "skillboard_cell_regen",
]);

/** Severity for the cross-engine notify() abstraction. */
export const notifySeverityEnum = pgEnum("notify_severity", [
  "info",
  "warn",
  "error",
  "critical",
]);

/** Channel a notify() call ended up routed to (audit). */
export const notifyChannelEnum = pgEnum("notify_channel", [
  "email",
  "cliq",
  "noop",
]);

/** Action proposed by Opus in a question_bank_proposal. */
export const proposalActionEnum = pgEnum("proposal_action", [
  "add",
  "retire",
  "rebalance",
  "add_below_standard",
  "add_band_extension",
]);

/** Who/what proposed a question bank change. */
export const proposalSourceEnum = pgEnum("proposal_source", [
  "opus_seed",
  "opus_weekly",
  "opus_override_triggered",
  "opus_band_extension",
]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "pending",
  "approved",
  "rejected",
]);

/** Field overridden on a validation result (drives required-reasoning rules). */
export const overrideFieldEnum = pgEnum("override_field", [
  "band",
  "level",
  "mindset_profile",
  "hire_recommendation",
  "qualified_scopes",
  "reservation_flags",
]);

/**
 * Lifecycle of an entry in `skillboard_authoring_jobs`. A worker (admin
 * UI loop OR Netlify scheduled function) moves rows pending → in_progress
 * → completed/failed via the claim-then-process pattern.
 */
export const authoringJobStatusEnum = pgEnum("authoring_job_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

/**
 * The Opus call shape a job represents.
 *   structure         — generate skills/tasks/mindsets for a new board
 *   task_cells        — generate the 15 (band × level) cells for one task
 *   cell_regeneration — regenerate one cell after rejection
 */
export const authoringJobTypeEnum = pgEnum("authoring_job_type", [
  "structure",
  "task_cells",
  "cell_regeneration",
  "bank_seed",
  "proposal_regeneration",
]);

/**
 * Drives prompt branching on cell-pass authoring (Pass 2).
 *   technical — hands-on engineering / installation / O&M
 *   bd_pm     — business development, sales, project management
 *   hybrid    — roles that mix both (e.g. Solar Project Manager)
 *
 * Captured at create-time on the admin form; can be changed via PATCH
 * before activation (changes don't auto-regenerate cells).
 */
export const skillboardRoleFamilyEnum = pgEnum("skillboard_role_family", [
  "technical",
  "bd_pm",
  "hybrid",
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
  /**
   * Number of times the /session Server Component rendered for this
   * response. 1 = normal first load; > 1 = the candidate refreshed or
   * navigated back. Surfaced in the admin drill-in as a soft audit
   * signal — high counts can indicate poor connectivity OR cheating
   * attempts, so it's never auto-blocking.
   */
  session_loads?: number;
  /**
   * Soft anti-cheating signals. None block the candidate; the drill-in
   * surfaces them for context and high values warrant a closer review.
   *  tab_blur_count   — page-visibility losses mid-session (tab switch,
   *                     app switch, screen lock).
   *  paste_count      — paste events on open-ended text answers.
   *  start_ip_hash    — sha-256 hash of the IP at /api/sessions create.
   *  submit_ip_hash   — sha-256 hash of the IP at finalize. Differing
   *                     pair = candidate's network changed mid-session.
   */
  tab_blur_count?: number;
  paste_count?: number;
  start_ip_hash?: string;
  submit_ip_hash?: string;
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
  /**
   * Talent Validation Engine (PRD §3) — `fixed` is the legacy V1 flow with
   * hand-authored questions stored on this assessment; `validation` switches
   * to the adaptive CAT flow that pulls from the question bank anchored to
   * `specialisation`. Default `fixed` preserves all existing rows.
   */
  mode: assessmentModeEnum("mode").notNull().default("fixed"),
  specialisation: text("specialisation"),
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
    /**
     * Free-form rubric for AI auto-scoring of open-ended answers.
     * Author-supplied: "required keywords", "preferred keywords",
     * "red-flag keywords", "must hit N", domain notes — whatever the
     * grader needs the model to weigh. The Gemini auto-score endpoint
     * passes this verbatim into the system prompt, and the model is
     * instructed to extend the logic with general engineering knowledge
     * (so candidates get credit for paraphrasing, not just keyword
     * bingo). Null = no rubric, AI scoring not available for this
     * question (admin must score manually).
     */
    scoringRubric: text("scoring_rubric"),
    /**
     * Talent Validation Engine — anchor a question to a specific cell of a
     * skillboard so the CAT engine can pick by (band, level, difficulty).
     * All nullable so existing fixed-mode V1 questions remain valid.
     */
    specialisation: text("specialisation"),
    band: seniorityBandEnum("band"),
    level: performanceLevelEnum("level"),
    skillId: uuid("skill_id").references(() => skills.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    difficultyScore: integer("difficulty_score"),
    competencyArea: text("competency_area"),
    weight: integer("weight").default(100),
    /**
     * Type-specific config for interactive question types — hotspot
     * regions, slider range/tolerance, sequence items, matching pairs,
     * scenario tree. Schema validated by the Phase 2 type-specific
     * validators; null for non-interactive types.
     */
    interactiveConfig: jsonb("interactive_config").$type<unknown>(),
  },
  (t) => [
    index("questions_assessment_id_idx").on(t.assessmentId),
    index("questions_validation_pick_idx").on(
      t.specialisation,
      t.band,
      t.level,
      t.difficultyScore,
    ),
  ],
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
    /**
     * Cross-check pipeline outcome. Populated by
     * POST /api/admin/responses/[id]/auto-score-all.
     */
    aiConsensus: aiConsensusEnum("ai_consensus").notNull().default("pending"),
    aiPipelineRanAt: timestamp("ai_pipeline_ran_at", { withTimezone: true }),
    /**
     * Response-level cheating deduction (0–100). Applied after per-answer
     * integrity penalties, so the final total = (integrity-adjusted sum)
     * × (1 − pct/100). Null = no response-level deduction.
     */
    integrityDeductionPct: integer("integrity_deduction_pct"),
    integrityDeductionRationale: text("integrity_deduction_rationale"),
    integrityDeductionSetBy: uuid("integrity_deduction_set_by"),
    integrityDeductionSetAt: timestamp("integrity_deduction_set_at", {
      withTimezone: true,
    }),
    /**
     * Talent Validation Engine lifecycle (PRD §11).
     *
     *   pending       — candidate is mid-flow (also typical of in_progress)
     *   scored        — Kimi synthesis wrote the Vetted Talent Profile
     *   human_review  — confidence < 0.70 or AI failed enum validation
     *   finalised     — a reviewer signed off / 90-day shadow review closed
     *
     * Null on legacy fixed-mode rows.
     */
    validationStatus: validationStatusEnum("validation_status"),
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
     * True when the candidate was actively recording (or had typed under the
     * 20-char minimum) at timeout but we couldn't recover usable input —
     * e.g. the audio upload failed in the timeout-submit path. Lets reviewers
     * see that effort was made even though no audio_path / text_response exists.
     */
    recordingAttempted: boolean("recording_attempted").notNull().default(false),
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
    /**
     * How the current score was set: a manual entry, or acceptance of a
     * persisted AI suggestion. Updated alongside score_awarded on every
     * save so the audit trail stays accurate.
     */
    scoreSource: scoreSourceEnum("score_source").notNull().default("manual"),
    /**
     * Free-text justification for the current score. Required by the API
     * whenever score_source = 'manual' (humans must explain their score
     * for AI-training purposes). For ai_* sources the AI's own rationale
     * lives on ai_scores.rationale; this column may be null in that case.
     */
    scoreRationale: text("score_rationale"),
    /**
     * Cheating-risk tag on this answer (null = unset, no penalty).
     *   low  → labelled only, no scoring effect
     *   mid  → answer's contribution to the total is zeroed
     *   high → -1 from this answer's contribution
     * Applied at total-score recompute; raw score_awarded is untouched so
     * the assessor's actual grading judgement is preserved.
     */
    integrityLevel: integrityLevelEnum("integrity_level"),
    integrityLevelSource: integritySourceEnum("integrity_level_source"),
    integrityLevelSetBy: uuid("integrity_level_set_by"),
    integrityLevelSetAt: timestamp("integrity_level_set_at", {
      withTimezone: true,
    }),
    answeredAt: timestamp("answered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Talent Validation Engine — multi-language pipeline (PRD §10).
     *
     * `detected_language` is set by the transcription or text-language
     * detector at submit time. When non-English, the Gemini Flash
     * translation pipeline fills `translated_text`/`translated_transcript`
     * and all downstream AI scoring reads from those. `translation_status`
     * is `not_needed` for English answers so the synthesis pipeline can
     * filter cleanly.
     */
    detectedLanguage: text("detected_language"),
    translatedText: text("translated_text"),
    translatedTranscript: text("translated_transcript"),
    translationStatus: translationStatusEnum("translation_status"),
    translationFailedReason: text("translation_failed_reason"),
    /**
     * Structured answer payload for interactive types — hotspot click
     * coords, drag sequence, slider value, matching pairs, scenario steps,
     * formula working. Schema validated per type by the route handler;
     * null for non-interactive types (MCQ/T-F/open use the existing
     * `selectedOptions`/`textResponse`/`audioPath` columns instead).
     */
    structuredAnswer: jsonb("structured_answer").$type<unknown>(),
    /**
     * Deterministic auto-scorer output, when the question type has one.
     * `{score, max, signals, reason}`. Distinct from the live
     * `scoreAwarded` because admins can still override; this is the raw
     * machine read.
     */
    autoScoreResult: jsonb("auto_score_result").$type<unknown>(),
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

export const answersRelations = relations(answers, ({ one, many }) => ({
  response: one(responses, {
    fields: [answers.responseId],
    references: [responses.id],
  }),
  question: one(questions, {
    fields: [answers.questionId],
    references: [questions.id],
  }),
  aiScores: many(aiScores),
}));

/**
 * ai_scores — one row per (answer_id, provider). Lets us keep BOTH a
 * Gemini suggestion and a Kimi cross-check on the same answer for the
 * superadmin diff view, without overloading the answers row.
 *
 * Unique on (answer_id, provider) so re-running the pipeline upserts
 * cleanly instead of layering history. If we later want history, swap
 * to a separate audit table — keeping the live row simple.
 */
export const aiScoreProviderEnum = pgEnum("ai_score_provider", [
  "gemini",
  "kimi",
]);

export const aiScores = pgTable(
  "ai_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    provider: aiScoreProviderEnum("provider").notNull(),
    score: integer("score").notNull(),
    rationale: text("rationale").notNull().default(""),
    hits: jsonb("hits").$type<string[]>().notNull().default([]),
    misses: jsonb("misses").$type<string[]>().notNull().default([]),
    redFlags: jsonb("red_flags").$type<string[]>().notNull().default([]),
    /**
     * AI's cheating-risk read on the answer (low / mid / high). Stored
     * separately from answers.integrity_level so the model's proposal is
     * auditable even after a human overrides it. Null = the model didn't
     * return one (older rows, prompts that don't ask for it).
     */
    integrityProposal: integrityLevelEnum("integrity_proposal"),
    integrityProposalRationale: text("integrity_proposal_rationale"),
    /**
     * Talent Validation Engine signals (PRD §6) — every per-answer AI score
     * now produces band/level/mindset/scope evidence that the synthesis
     * step aggregates into the Vetted Talent Profile.
     *
     *   level_signal   — `below` | `nh` | `g` | `p` | `tp` | null (no_signal)
     *   band_signal    — `junior` | `mid` | `senior` | null
     *   mindset_signal — `[{mindset: string, strength: 'strong'|'emerging'|'absent'}]`
     *   scope_signals  — string[] of qualified_scope ids the answer evidences
     */
    levelSignal: performanceLevelEnum("level_signal"),
    bandSignal: seniorityBandEnum("band_signal"),
    mindsetSignal: jsonb("mindset_signal").$type<unknown>(),
    scopeSignals: jsonb("scope_signals").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_scores_answer_idx").on(t.answerId),
    unique("ai_scores_answer_provider_uniq").on(t.answerId, t.provider),
  ],
);

export const aiScoresRelations = relations(aiScores, ({ one }) => ({
  answer: one(answers, {
    fields: [aiScores.answerId],
    references: [answers.id],
  }),
}));

/**
 * score_history — every prior score on an answer.
 *
 * Written by the score PATCH endpoint *before* it overwrites the current
 * answers row. Captures the value being replaced (score, source, who
 * scored it, when) plus the rationale that justified it. Lets us:
 *
 *   1. Show reviewers a per-answer audit trail of every score that's
 *      ever been there.
 *   2. Feed AI training with (answer, rationale → score) tuples,
 *      including human disagreements that the current row no longer
 *      reflects.
 *
 * Only ever appended to — never updated, never deleted (except via
 * cascade when the answer itself is deleted).
 */
export const scoreHistory = pgTable(
  "score_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => answers.id, { onDelete: "cascade" }),
    scoreAwarded: integer("score_awarded").notNull(),
    scoreSource: scoreSourceEnum("score_source").notNull(),
    scoreRationale: text("score_rationale"),
    /** admin_users.id of the person whose score this was. */
    scoredBy: uuid("scored_by"),
    /** When the score being snapshotted was originally entered. */
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    /** When the new score overwrote this one (i.e. when this row was written). */
    replacedAt: timestamp("replaced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** admin_users.id of the person whose action created this history row. */
    replacedBy: uuid("replaced_by"),
  },
  (t) => [index("score_history_answer_idx").on(t.answerId, t.replacedAt)],
);

export const scoreHistoryRelations = relations(scoreHistory, ({ one }) => ({
  answer: one(answers, {
    fields: [scoreHistory.answerId],
    references: [answers.id],
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
  /**
   * Talent Validation Engine — `Learning Expert` permission (PRD §1b).
   * Grants the holder approval rights over skillboard cells. Held by a
   * subset of `editor` and `superadmin` users; defaults false. `admin`
   * tier cannot grant; only `superadmin` may grant/revoke (enforced in
   * the API layer, not the DB).
   */
  canApproveSkillboards: boolean("can_approve_skillboards")
    .notNull()
    .default(false),
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
/**
 * feature_flags — runtime config keyed by a stable string.
 *
 * Today only `ai_scoring_visibility` lives here (which admin roles see
 * AI panels). DB lookup so a superadmin can flip it without redeploying;
 * if no row exists, callers fall back to the AI_SCORING_VISIBLE_TO env
 * var so existing deployments keep working.
 */
export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabledForRoles: text("enabled_for_roles")
    .array()
    .notNull()
    .default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedBy: uuid("updated_by"),
});

/**
 * candidate_profiles — local-dev SHIM for the Onboarding Engine.
 *
 * In production the Validation Engine reads candidate profiles via the
 * cross-engine HTTP contract (`GET /api/internal/candidates/[id]/profile`).
 * Until podsproject on Railway is wired to call us, an admin authors
 * profiles here via /admin/candidate-profiles. The same HTTP endpoint
 * falls back to reading this table when ONBOARDING_API_URL is unset.
 *
 * Delete this table once Onboarding integration is live.
 */
export const candidateProfiles = pgTable("candidate_profiles", {
  candidateId: text("candidate_id").primaryKey(),
  profileJson: jsonb("profile_json").$type<unknown>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CandidateProfileRow = typeof candidateProfiles.$inferSelect;
export type NewCandidateProfileRow = typeof candidateProfiles.$inferInsert;

export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type AiScore = typeof aiScores.$inferSelect;
export type NewAiScore = typeof aiScores.$inferInsert;
export type ScoreHistoryRow = typeof scoreHistory.$inferSelect;
export type NewScoreHistoryRow = typeof scoreHistory.$inferInsert;
export type IntegrityLevel = (typeof integrityLevelEnum.enumValues)[number];
export type IntegritySource = (typeof integritySourceEnum.enumValues)[number];
export type AiConsensus = (typeof aiConsensusEnum.enumValues)[number];
export type AiScoreProvider = (typeof aiScoreProviderEnum.enumValues)[number];
export type ScoreSource = (typeof scoreSourceEnum.enumValues)[number];

/* ═══════════════════════════════════════════════════════════════════════════
 *  TALENT VALIDATION ENGINE — Phase 0 tables (PRD 2026-05-11)
 *  Engine boundary: this section is owned exclusively by the Validation
 *  Engine. Cross-engine reads (e.g. Matching, Training) must go through
 *  GET /api/profiles/[candidate_id], not direct table queries.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ---------- jsonb shapes (Validation Engine) ---------- */

export type SkillboardMindset = { name: string; description: string };

/**
 * One entry in skillboards.feedback_notes. Captured automatically when
 * a cell or proposal is rejected; surfaced back into future Opus
 * prompts so the brief learns from every rejection.
 *
 *   source = 'cell' : entry came from a level_expectations rejection
 *   source = 'proposal' : entry came from a question_bank_proposals reject
 *
 * `context` is free-text describing what was being authored when the
 * note was captured (e.g. "Junior · Growing · 'Measure roof…' task").
 */
export type SkillboardFeedbackEntry = {
  at: string; // ISO timestamp
  by: string; // admin uuid
  source: "cell" | "proposal";
  notes: string;
  context?: string;
};
export type SkillboardBehaviouralSkill = { name: string; description: string };
export type SkillboardSourceFile =
  | { kind: "upload"; filename: string; storage_path: string; mime: string }
  | { kind: "url"; value: string };

/** Per-skill row inside a Vetted Talent Profile's per-skill breakdown. */
export type PerSkillBreakdownRow = {
  skill_id: string;
  skill_name: string;
  level: "below" | "nh" | "g" | "p" | "tp";
  evidence_answer_ids: string[];
};

export type MindsetProfileEntry = {
  mindset: string;
  strength: "strong" | "emerging" | "absent";
  evidence_count: number;
};

export type ReservationFlag = {
  flag: string;
  severity: "info" | "warn" | "critical";
  evidence_answer_id: string | null;
};

/** Adaptive plan trace stored on responses.metadata.adaptive_plan. */
export type AdaptivePlanEntry = {
  specialisation: string;
  role: "primary" | "secondary";
  budget: number;
  state:
    | "calibrating"
    | "probing_up"
    | "probing_down"
    | "refining"
    | "stabilised";
  band_locked: "junior" | "mid" | "senior" | null;
  level_running: "below" | "nh" | "g" | "p" | "tp" | null;
  question_ids: string[];
  transitions: { at_question: number; from: string; to: string }[];
};

/* ---------- Skillboards ---------- */

export const skillboards = pgTable("skillboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  specialisation: text("specialisation").notNull().unique(),
  description: text("description").notNull().default(""),
  version: integer("version").notNull().default(1),
  mindsets: jsonb("mindsets")
    .$type<SkillboardMindset[]>()
    .notNull()
    .default([]),
  behaviouralSkills: jsonb("behavioural_skills")
    .$type<SkillboardBehaviouralSkill[]>()
    .notNull()
    .default([]),
  parentSkillboardId: uuid("parent_skillboard_id"),
  creationPath: skillboardCreationPathEnum("creation_path").notNull(),
  /**
   * Drives prompt branching on cell-pass authoring. Defaults to
   * `technical` to keep existing-test rows valid; admin sets explicitly
   * via the create form.
   */
  roleFamily: skillboardRoleFamilyEnum("role_family")
    .notNull()
    .default("technical"),
  sourceFiles: jsonb("source_files").$type<SkillboardSourceFile[]>(),
  claudeAuthoringBrief: text("claude_authoring_brief"),
  claudeAuthoringRunId: uuid("claude_authoring_run_id"),
  /**
   * Set when every level_expectations cell on this board reaches
   * `approved` — the gate that lets the CAT engine pick questions
   * anchored to it. Null while any cell is still pending or rejected.
   */
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  /**
   * Soft-delete. Hidden from default admin lists and from POST
   * /api/internal/sessions resolution while non-null. Historical
   * responses/profiles still resolve their structure though, so the
   * row stays around indefinitely. To undo, set back to null.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * Accumulated reviewer feedback corpus. Every cell rejection or
   * question-bank-proposal rejection auto-appends an entry. Read by
   * buildFeedbackContextBlock() and injected into seed/regen/structure
   * Opus prompts as "Past reviewer feedback to address" — so the
   * skillboard's brief effectively learns from each rejection.
   *
   * Admins can curate via the skillboard edit panel (trim, edit, etc.).
   */
  feedbackNotes: jsonb("feedback_notes")
    .$type<SkillboardFeedbackEntry[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillboardId: uuid("skillboard_id")
      .notNull()
      .references(() => skillboards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => [index("skills_skillboard_idx").on(t.skillboardId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull().default(0),
  },
  (t) => [index("tasks_skill_idx").on(t.skillId)],
);

export const levelExpectations = pgTable(
  "level_expectations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    band: seniorityBandEnum("band").notNull(),
    level: performanceLevelEnum("level").notNull(),
    expectationText: text("expectation_text").notNull().default(""),
    /**
     * True when Claude (Opus) authored the cell text, false when a human
     * did (via upload parse or in-line edit). Drives the per-cell origin
     * badge in the admin UI.
     */
    synthesised: boolean("synthesised").notNull().default(false),
    approvalState: approvalStateEnum("approval_state")
      .notNull()
      .default("pending"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /**
     * Carried back to Claude when regenerating this cell after rejection
     * (PRD §1b "Reject with notes (sends the cell back to Claude...)").
     */
    rejectionNotes: text("rejection_notes"),
    /**
     * Caps at 3 per cell (enforced in API). Beyond that the reviewer
     * must edit-then-approve or escalate to superadmin — stops runaway
     * Opus spend on a single difficult cell.
     */
    regenerationCount: integer("regeneration_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("level_expectations_task_idx").on(t.taskId),
    unique("level_expectations_task_band_level_uniq").on(
      t.taskId,
      t.band,
      t.level,
    ),
  ],
);

/* ---------- Vetted Talent Profile ---------- */

export const vettedTalentProfile = pgTable(
  "vetted_talent_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => responses.id, { onDelete: "cascade" }),
    /**
     * Denormalised candidate identifier (the ETC-XXXXX from the
     * Onboarding engine's talent_profiles). Cached here so Matching /
     * POD / Training can fetch profiles by candidate_id without
     * joining through responses.
     */
    candidateId: text("candidate_id").notNull(),
    specialisation: text("specialisation").notNull(),
    claimedBand: seniorityBandEnum("claimed_band").notNull(),
    finalBand: seniorityBandEnum("final_band").notNull(),
    finalLevel: performanceLevelEnum("final_level").notNull(),
    /** Learner-facing label (see [[cadre-vs-band]] memory). */
    cadre: cadreEnum("cadre").notNull(),
    /** Generated, e.g. "Mid-Level Solar Tech, performing at Pro". */
    displayLabel: text("display_label").notNull(),
    perSkillBreakdown: jsonb("per_skill_breakdown")
      .$type<PerSkillBreakdownRow[]>()
      .notNull()
      .default([]),
    mindsetProfile: jsonb("mindset_profile")
      .$type<MindsetProfileEntry[]>()
      .notNull()
      .default([]),
    qualifiedScopes: jsonb("qualified_scopes")
      .$type<string[]>()
      .notNull()
      .default([]),
    reservationFlags: jsonb("reservation_flags")
      .$type<ReservationFlag[]>()
      .notNull()
      .default([]),
    confidence: integer("confidence_x100").notNull(),
    rationale: text("rationale").notNull().default(""),
    finalSource: finalSourceEnum("final_source").notNull().default("ai"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("vetted_talent_profile_candidate_idx").on(t.candidateId),
    unique("vetted_talent_profile_response_spec_uniq").on(
      t.responseId,
      t.specialisation,
    ),
  ],
);

export const validationResults = pgTable("validation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  responseId: uuid("response_id")
    .notNull()
    .references(() => responses.id, { onDelete: "cascade" })
    .unique(),
  hireRecommendation: hireRecommendationEnum("hire_recommendation").notNull(),
  /** Min across per-spec confidences, 0–100 (stored as int x100). */
  confidence: integer("confidence_x100").notNull(),
  requiresHumanReview: boolean("requires_human_review")
    .notNull()
    .default(false),
  synthesisedBy: text("synthesised_by").notNull().default("kimi"),
  synthesisedAt: timestamp("synthesised_at", { withTimezone: true }),
  finalSource: finalSourceEnum("final_source").notNull().default("ai"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const validationOverrides = pgTable(
  "validation_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    validationResultId: uuid("validation_result_id")
      .notNull()
      .references(() => validationResults.id, { onDelete: "cascade" }),
    vettedTalentProfileId: uuid("vetted_talent_profile_id").references(
      () => vettedTalentProfile.id,
      { onDelete: "cascade" },
    ),
    field: overrideFieldEnum("field").notNull(),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    /**
     * Required (≥ 20 chars) for band shifts, hire/no-hire flips, and
     * scope add/remove. The API rejects the save without it.
     */
    reasoning: text("reasoning").notNull(),
    overriddenBy: uuid("overridden_by").notNull(),
    overriddenAt: timestamp("overridden_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("validation_overrides_result_idx").on(
      t.validationResultId,
      t.overriddenAt,
    ),
  ],
);

/* ---------- Learning summaries (in-engine slice of Learning Engine) ---------- */

export const learningSummaries = pgTable(
  "learning_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specialisation: text("specialisation").notNull(),
    band: seniorityBandEnum("band").notNull(),
    summary: text("summary").notNull().default(""),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** `system` or admin email. */
    updatedBy: text("updated_by").notNull().default("system"),
  },
  (t) => [
    unique("learning_summaries_spec_band_uniq").on(t.specialisation, t.band),
  ],
);

export const learningSummaryHistory = pgTable(
  "learning_summary_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specialisation: text("specialisation").notNull(),
    band: seniorityBandEnum("band").notNull(),
    summary: text("summary").notNull(),
    version: integer("version").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("learning_summary_history_spec_band_idx").on(
      t.specialisation,
      t.band,
      t.archivedAt,
    ),
  ],
);

/* ---------- Question bank proposals (Opus seed + weekly refresh) ---------- */

export const questionBankProposals = pgTable(
  "question_bank_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specialisation: text("specialisation").notNull(),
    band: seniorityBandEnum("band"),
    level: performanceLevelEnum("level"),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    action: proposalActionEnum("action").notNull(),
    /**
     * For `add` actions: the full proposed Question + rubric +
     * interactive_config. For `retire`/`rebalance`: `{question_id,
     * adjustment}`. Validated by the proposal review endpoint.
     */
    payload: jsonb("payload").$type<unknown>().notNull(),
    proposedBy: proposalSourceEnum("proposed_by").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: proposalStatusEnum("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNotes: text("review_notes"),
  },
  (t) => [
    index("question_bank_proposals_status_idx").on(t.status, t.proposedAt),
    index("question_bank_proposals_spec_idx").on(
      t.specialisation,
      t.band,
      t.level,
    ),
  ],
);

/* ---------- AI spend ledger ---------- */

export const aiSpendLedger = pgTable(
  "ai_spend_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    model: aiSpendModelEnum("model").notNull(),
    purpose: aiSpendPurposeEnum("purpose").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** USD x10000 (so $0.0001 precision in an int). */
    costUsdX10000: integer("cost_usd_x10000").notNull().default(0),
    calledAt: timestamp("called_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    success: boolean("success").notNull().default(true),
  },
  (t) => [index("ai_spend_ledger_model_called_idx").on(t.model, t.calledAt)],
);

/* ---------- Notify log ---------- */

export const notifyLog = pgTable("notify_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  severity: notifySeverityEnum("severity").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<unknown>().notNull().default({}),
  channel: notifyChannelEnum("channel").notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deliveryStatus: text("delivery_status").notNull().default("ok"),
});

/* ---------- Skillboard authoring job queue ---------- */

/**
 * One row per Opus call planned against a skillboard. A worker (admin
 * UI poll loop OR Netlify scheduled fn) claims pending rows and runs
 * them sequentially, recording the result here and in `ai_spend_ledger`.
 *
 * Why a queue table instead of a background function:
 *   - Zero new infra (works on free Netlify tier)
 *   - Queryable audit log (PRD likes auditability)
 *   - Granular retries: one task failing doesn't blow up the other 24
 *   - Stuck-job detection: claimed_at + a timeout = "abandoned, retry"
 */
export const skillboardAuthoringJobs = pgTable(
  "skillboard_authoring_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skillboardId: uuid("skillboard_id")
      .notNull()
      .references(() => skillboards.id, { onDelete: "cascade" }),
    jobType: authoringJobTypeEnum("job_type").notNull(),
    /** Set for task_cells jobs. Null for structure jobs. */
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "cascade",
    }),
    /** Set for cell_regeneration jobs. */
    levelExpectationId: uuid("level_expectation_id").references(
      () => levelExpectations.id,
      { onDelete: "cascade" },
    ),
    status: authoringJobStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    /**
     * When the worker claimed the row. Used by the stuck-job detector
     * to recover rows that crashed mid-process (claimed_at older than
     * the timeout AND status still in_progress → reset to pending).
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Parsed Opus output. Stored for replay / audit on failure. */
    result: jsonb("result").$type<unknown>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdX10000: integer("cost_usd_x10000"),
    /**
     * Set true when a job is staged (created but not yet released to
     * the worker). Used by the "Stage regenerations for review" flow
     * in bulk-reject — admin reviews the scope + cost before clicking
     * Start to release. Worker queries always exclude paused jobs.
     */
    pausedUntilReview: boolean("paused_until_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("skillboard_authoring_jobs_skillboard_idx").on(
      t.skillboardId,
      t.status,
    ),
  ],
);

/* ---------- Relations (Validation Engine) ---------- */

export const skillboardsRelations = relations(skillboards, ({ many }) => ({
  skills: many(skills),
}));

export const skillsRelations = relations(skills, ({ one, many }) => ({
  skillboard: one(skillboards, {
    fields: [skills.skillboardId],
    references: [skillboards.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  skill: one(skills, {
    fields: [tasks.skillId],
    references: [skills.id],
  }),
  levelExpectations: many(levelExpectations),
}));

export const levelExpectationsRelations = relations(
  levelExpectations,
  ({ one }) => ({
    task: one(tasks, {
      fields: [levelExpectations.taskId],
      references: [tasks.id],
    }),
  }),
);

export const vettedTalentProfileRelations = relations(
  vettedTalentProfile,
  ({ one }) => ({
    response: one(responses, {
      fields: [vettedTalentProfile.responseId],
      references: [responses.id],
    }),
  }),
);

export const validationResultsRelations = relations(
  validationResults,
  ({ one, many }) => ({
    response: one(responses, {
      fields: [validationResults.responseId],
      references: [responses.id],
    }),
    overrides: many(validationOverrides),
  }),
);

export const validationOverridesRelations = relations(
  validationOverrides,
  ({ one }) => ({
    result: one(validationResults, {
      fields: [validationOverrides.validationResultId],
      references: [validationResults.id],
    }),
    profile: one(vettedTalentProfile, {
      fields: [validationOverrides.vettedTalentProfileId],
      references: [vettedTalentProfile.id],
    }),
  }),
);

/* ---------- Inferred row types (Validation Engine) ---------- */

export type Skillboard = typeof skillboards.$inferSelect;
export type NewSkillboard = typeof skillboards.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type LevelExpectation = typeof levelExpectations.$inferSelect;
export type NewLevelExpectation = typeof levelExpectations.$inferInsert;
export type VettedTalentProfile = typeof vettedTalentProfile.$inferSelect;
export type NewVettedTalentProfile = typeof vettedTalentProfile.$inferInsert;
export type ValidationResult = typeof validationResults.$inferSelect;
export type NewValidationResult = typeof validationResults.$inferInsert;
export type ValidationOverride = typeof validationOverrides.$inferSelect;
export type NewValidationOverride = typeof validationOverrides.$inferInsert;
export type LearningSummary = typeof learningSummaries.$inferSelect;
export type NewLearningSummary = typeof learningSummaries.$inferInsert;
export type LearningSummaryHistoryRow =
  typeof learningSummaryHistory.$inferSelect;
export type NewLearningSummaryHistoryRow =
  typeof learningSummaryHistory.$inferInsert;
export type QuestionBankProposal = typeof questionBankProposals.$inferSelect;
export type NewQuestionBankProposal = typeof questionBankProposals.$inferInsert;
export type AiSpendLedgerRow = typeof aiSpendLedger.$inferSelect;
export type NewAiSpendLedgerRow = typeof aiSpendLedger.$inferInsert;
export type NotifyLogRow = typeof notifyLog.$inferSelect;
export type NewNotifyLogRow = typeof notifyLog.$inferInsert;

export type SeniorityBand = (typeof seniorityBandEnum.enumValues)[number];
export type PerformanceLevel = (typeof performanceLevelEnum.enumValues)[number];
export type Cadre = (typeof cadreEnum.enumValues)[number];
export type ValidationStatus =
  (typeof validationStatusEnum.enumValues)[number];
export type HireRecommendation =
  (typeof hireRecommendationEnum.enumValues)[number];
export type FinalSource = (typeof finalSourceEnum.enumValues)[number];
export type SkillboardCreationPath =
  (typeof skillboardCreationPathEnum.enumValues)[number];
export type ApprovalState = (typeof approvalStateEnum.enumValues)[number];
export type TranslationStatus =
  (typeof translationStatusEnum.enumValues)[number];
export type AiSpendModel = (typeof aiSpendModelEnum.enumValues)[number];
export type AiSpendPurpose = (typeof aiSpendPurposeEnum.enumValues)[number];
export type NotifySeverity = (typeof notifySeverityEnum.enumValues)[number];
export type NotifyChannel = (typeof notifyChannelEnum.enumValues)[number];
export type ProposalAction = (typeof proposalActionEnum.enumValues)[number];
export type ProposalSource = (typeof proposalSourceEnum.enumValues)[number];
export type ProposalStatus = (typeof proposalStatusEnum.enumValues)[number];
export type OverrideField = (typeof overrideFieldEnum.enumValues)[number];
export type AssessmentMode = (typeof assessmentModeEnum.enumValues)[number];
export type AuthoringJobStatus =
  (typeof authoringJobStatusEnum.enumValues)[number];
export type AuthoringJobType =
  (typeof authoringJobTypeEnum.enumValues)[number];
export type SkillboardRoleFamily =
  (typeof skillboardRoleFamilyEnum.enumValues)[number];

export type SkillboardAuthoringJob =
  typeof skillboardAuthoringJobs.$inferSelect;
export type NewSkillboardAuthoringJob =
  typeof skillboardAuthoringJobs.$inferInsert;

/* ========================================================================== *
 *  TENANT FOUNDATION (PRD 2026-06-02-tenant-assessment-builder.md, Phase 0)  *
 * ========================================================================== *
 * Two-tier auth mirrors admin_users: Supabase magic-link verifies the email,
 * then the email must also exist in tenant_users (scoped to one tenant).
 *
 * Country is locked at signup; currency + pricing_tier derive from it via
 * lib/tenant/country.ts. Moving country = new account.
 */

export const tenantPricingTierEnum = pgEnum("tenant_pricing_tier", [
  "nigeria",
  "international",
  "us",
]);

export const tenantRoleEnum = pgEnum("tenant_role", [
  "owner",
  "admin",
  "member",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * ISO 3166-1 alpha-2 for NG/UK/CA/AE/US. 'XK' is an internal sentinel
   * for the Caribbean grouping in the PRD (no single ISO code).
   */
  countryCode: text("country_code").notNull(),
  currencyCode: text("currency_code").notNull(),
  pricingTier: tenantPricingTierEnum("pricing_tier").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantUsers = pgTable("tenant_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  role: tenantRoleEnum("role").notNull().default("member"),
  invitedBy: uuid("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type TenantUser = typeof tenantUsers.$inferSelect;
export type NewTenantUser = typeof tenantUsers.$inferInsert;
export type TenantPricingTier =
  (typeof tenantPricingTierEnum.enumValues)[number];
export type TenantRole = (typeof tenantRoleEnum.enumValues)[number];

/**
 * Tenant assessment branding (PRD §0b, migration 0018). Read by:
 *   - admin live preview pane
 *   - <TenantThemeProvider /> on /tenant pages
 *   - the candidate-facing runner to skin candidate UI
 *
 * `onboarding_completed_at IS NULL` gates the first-run carousel.
 */
export const tenantAssessmentBranding = pgTable("tenant_assessment_branding", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  primaryColor: text("primary_color").notNull().default("#f1b240"),
  accentColor: text("accent_color").notNull().default("#020301"),
  logoUrl: text("logo_url"),
  onboardingCompletedAt: timestamp("onboarding_completed_at", {
    withTimezone: true,
  }),
  updatedByUserId: uuid("updated_by_user_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenantAssessmentBranding =
  typeof tenantAssessmentBranding.$inferSelect;
export type NewTenantAssessmentBranding =
  typeof tenantAssessmentBranding.$inferInsert;

/**
 * Hardcoded brand defaults so callers that have no row yet still render
 * with ETC's palette and the candidate runner doesn't crash on null.
 */
export const TENANT_BRAND_DEFAULTS = {
  primaryColor: "#f1b240",
  accentColor: "#020301",
  logoUrl: null as string | null,
} as const;
