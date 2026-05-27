-- ============================================================================
-- 0011 — Talent Validation Engine (Phase 0)
-- PRD: docs/2026-05-11-talent-validation-engine_3.md
-- All additions are additive: no DROP, no destructive ALTER.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- New enums
-- ----------------------------------------------------------------------------

CREATE TYPE "assessment_mode" AS ENUM ('fixed', 'validation');
CREATE TYPE "seniority_band" AS ENUM ('junior', 'mid', 'senior');
CREATE TYPE "performance_level" AS ENUM ('below', 'nh', 'g', 'p', 'tp');
CREATE TYPE "cadre" AS ENUM ('el', 'int', 'expd', 'adv', 'expt');
CREATE TYPE "validation_status" AS ENUM ('pending', 'scored', 'human_review', 'finalised');
CREATE TYPE "hire_recommendation" AS ENUM ('hire', 'no_hire', 'borderline', 'requires_human_review');
CREATE TYPE "final_source" AS ENUM ('ai', 'human_override');
CREATE TYPE "skillboard_creation_path" AS ENUM ('upload', 'claude_authored');
CREATE TYPE "approval_state" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "translation_status" AS ENUM ('not_needed', 'pending', 'done', 'failed');
CREATE TYPE "ai_spend_model" AS ENUM ('opus', 'gemini_pro', 'gemini_flash', 'kimi');
CREATE TYPE "ai_spend_purpose" AS ENUM (
    'question_seed', 'weekly_refresh', 'synthesis', 'scoring',
    'translation', 'transcription', 'below_standard_synthesis',
    'band_extension_synthesis', 'learning_summary',
    'skillboard_authoring', 'skillboard_cell_regen'
);
CREATE TYPE "notify_severity" AS ENUM ('info', 'warn', 'error', 'critical');
CREATE TYPE "notify_channel" AS ENUM ('email', 'cliq', 'noop');
CREATE TYPE "proposal_action" AS ENUM ('add', 'retire', 'rebalance', 'add_below_standard', 'add_band_extension');
CREATE TYPE "proposal_source" AS ENUM (
    'opus_seed', 'opus_weekly', 'opus_override_triggered', 'opus_band_extension'
);
CREATE TYPE "proposal_status" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "override_field" AS ENUM (
    'band', 'level', 'mindset_profile', 'hire_recommendation',
    'qualified_scopes', 'reservation_flags'
);
CREATE TYPE "authoring_job_status" AS ENUM (
    'pending', 'in_progress', 'completed', 'failed'
);
CREATE TYPE "authoring_job_type" AS ENUM (
    'structure', 'task_cells', 'cell_regeneration'
);
CREATE TYPE "skillboard_role_family" AS ENUM (
    'technical', 'bd_pm', 'hybrid'
);

-- Extend question_type with 5 new interactive types.
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'hotspot';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'sequence';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'slider';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'matching';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'scenario';

-- ----------------------------------------------------------------------------
-- Additive columns on existing tables
-- ----------------------------------------------------------------------------

-- assessments: validation mode + specialisation pointer
ALTER TABLE "assessments" ADD COLUMN "mode" "assessment_mode" NOT NULL DEFAULT 'fixed';
ALTER TABLE "assessments" ADD COLUMN "specialisation" text;

-- admin_users: Learning Expert permission
ALTER TABLE "admin_users" ADD COLUMN "can_approve_skillboards" boolean NOT NULL DEFAULT false;

-- responses: validation lifecycle
ALTER TABLE "responses" ADD COLUMN "validation_status" "validation_status";

-- answers: translation + structured-payload columns
ALTER TABLE "answers" ADD COLUMN "detected_language" text;
ALTER TABLE "answers" ADD COLUMN "translated_text" text;
ALTER TABLE "answers" ADD COLUMN "translated_transcript" text;
ALTER TABLE "answers" ADD COLUMN "translation_status" "translation_status";
ALTER TABLE "answers" ADD COLUMN "translation_failed_reason" text;
ALTER TABLE "answers" ADD COLUMN "structured_answer" jsonb;
ALTER TABLE "answers" ADD COLUMN "auto_score_result" jsonb;

-- ai_scores: band/level/mindset/scope signals
ALTER TABLE "ai_scores" ADD COLUMN "level_signal" "performance_level";
ALTER TABLE "ai_scores" ADD COLUMN "band_signal" "seniority_band";
ALTER TABLE "ai_scores" ADD COLUMN "mindset_signal" jsonb;
ALTER TABLE "ai_scores" ADD COLUMN "scope_signals" jsonb;

-- ----------------------------------------------------------------------------
-- New tables — skillboard spine
-- ----------------------------------------------------------------------------

CREATE TABLE "skillboards" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "specialisation" text NOT NULL UNIQUE,
    "description" text NOT NULL DEFAULT '',
    "version" integer NOT NULL DEFAULT 1,
    "mindsets" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "behavioural_skills" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "parent_skillboard_id" uuid,
    "creation_path" "skillboard_creation_path" NOT NULL,
    /**
     * Drives prompt branching on cell-pass authoring (Pass 2). Captured
     * at create-time on the admin form.
     *   technical — hands-on engineering / installation / O&M
     *   bd_pm     — business development, sales, project management
     *   hybrid    — roles that mix both (e.g. Solar Project Manager)
     */
    "role_family" "skillboard_role_family" NOT NULL DEFAULT 'technical',
    "source_files" jsonb,
    "claude_authoring_brief" text,
    "claude_authoring_run_id" uuid,
    "activated_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "skills" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "skillboard_id" uuid NOT NULL REFERENCES "skillboards"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "order_index" integer NOT NULL DEFAULT 0
);
CREATE INDEX "skills_skillboard_idx" ON "skills" ("skillboard_id");

CREATE TABLE "tasks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "order_index" integer NOT NULL DEFAULT 0
);
CREATE INDEX "tasks_skill_idx" ON "tasks" ("skill_id");

CREATE TABLE "level_expectations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "task_id" uuid NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
    "band" "seniority_band" NOT NULL,
    "level" "performance_level" NOT NULL,
    "expectation_text" text NOT NULL DEFAULT '',
    "synthesised" boolean NOT NULL DEFAULT false,
    "approval_state" "approval_state" NOT NULL DEFAULT 'pending',
    "approved_by" uuid,
    "approved_at" timestamptz,
    "rejection_notes" text,
    "regeneration_count" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "level_expectations_task_idx" ON "level_expectations" ("task_id");
ALTER TABLE "level_expectations"
    ADD CONSTRAINT "level_expectations_task_band_level_uniq" UNIQUE ("task_id", "band", "level");

-- ----------------------------------------------------------------------------
-- Now that skills/tasks exist, add FKs from `questions` to them
-- ----------------------------------------------------------------------------

ALTER TABLE "questions" ADD COLUMN "specialisation" text;
ALTER TABLE "questions" ADD COLUMN "band" "seniority_band";
ALTER TABLE "questions" ADD COLUMN "level" "performance_level";
ALTER TABLE "questions" ADD COLUMN "skill_id" uuid REFERENCES "skills"("id") ON DELETE SET NULL;
ALTER TABLE "questions" ADD COLUMN "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL;
ALTER TABLE "questions" ADD COLUMN "difficulty_score" integer;
ALTER TABLE "questions" ADD COLUMN "competency_area" text;
ALTER TABLE "questions" ADD COLUMN "weight" integer DEFAULT 100;
ALTER TABLE "questions" ADD COLUMN "interactive_config" jsonb;

CREATE INDEX "questions_validation_pick_idx"
    ON "questions" ("specialisation", "band", "level", "difficulty_score");

-- ----------------------------------------------------------------------------
-- Vetted Talent Profile + Validation Results + Overrides
-- ----------------------------------------------------------------------------

CREATE TABLE "vetted_talent_profile" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "response_id" uuid NOT NULL REFERENCES "responses"("id") ON DELETE CASCADE,
    "candidate_id" text NOT NULL,
    "specialisation" text NOT NULL,
    "claimed_band" "seniority_band" NOT NULL,
    "final_band" "seniority_band" NOT NULL,
    "final_level" "performance_level" NOT NULL,
    "cadre" "cadre" NOT NULL,
    "display_label" text NOT NULL,
    "per_skill_breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "mindset_profile" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "qualified_scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "reservation_flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "confidence_x100" integer NOT NULL,
    "rationale" text NOT NULL DEFAULT '',
    "final_source" "final_source" NOT NULL DEFAULT 'ai',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "vetted_talent_profile_candidate_idx" ON "vetted_talent_profile" ("candidate_id");
ALTER TABLE "vetted_talent_profile"
    ADD CONSTRAINT "vetted_talent_profile_response_spec_uniq" UNIQUE ("response_id", "specialisation");

CREATE TABLE "validation_results" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "response_id" uuid NOT NULL UNIQUE REFERENCES "responses"("id") ON DELETE CASCADE,
    "hire_recommendation" "hire_recommendation" NOT NULL,
    "confidence_x100" integer NOT NULL,
    "requires_human_review" boolean NOT NULL DEFAULT false,
    "synthesised_by" text NOT NULL DEFAULT 'kimi',
    "synthesised_at" timestamptz,
    "final_source" "final_source" NOT NULL DEFAULT 'ai',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "validation_overrides" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "validation_result_id" uuid NOT NULL REFERENCES "validation_results"("id") ON DELETE CASCADE,
    "vetted_talent_profile_id" uuid REFERENCES "vetted_talent_profile"("id") ON DELETE CASCADE,
    "field" "override_field" NOT NULL,
    "old_value" jsonb,
    "new_value" jsonb,
    "reasoning" text NOT NULL,
    "overridden_by" uuid NOT NULL,
    "overridden_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "validation_overrides_result_idx"
    ON "validation_overrides" ("validation_result_id", "overridden_at");

-- ----------------------------------------------------------------------------
-- Learning summaries (in-engine slice of the Learning Engine)
-- ----------------------------------------------------------------------------

CREATE TABLE "learning_summaries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "specialisation" text NOT NULL,
    "band" "seniority_band" NOT NULL,
    "summary" text NOT NULL DEFAULT '',
    "version" integer NOT NULL DEFAULT 1,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "updated_by" text NOT NULL DEFAULT 'system'
);
ALTER TABLE "learning_summaries"
    ADD CONSTRAINT "learning_summaries_spec_band_uniq" UNIQUE ("specialisation", "band");

CREATE TABLE "learning_summary_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "specialisation" text NOT NULL,
    "band" "seniority_band" NOT NULL,
    "summary" text NOT NULL,
    "version" integer NOT NULL,
    "archived_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "learning_summary_history_spec_band_idx"
    ON "learning_summary_history" ("specialisation", "band", "archived_at");

-- ----------------------------------------------------------------------------
-- Question bank proposals (Opus seed + weekly refresh outputs)
-- ----------------------------------------------------------------------------

CREATE TABLE "question_bank_proposals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "specialisation" text NOT NULL,
    "band" "seniority_band",
    "level" "performance_level",
    "task_id" uuid REFERENCES "tasks"("id") ON DELETE SET NULL,
    "action" "proposal_action" NOT NULL,
    "payload" jsonb NOT NULL,
    "proposed_by" "proposal_source" NOT NULL,
    "proposed_at" timestamptz NOT NULL DEFAULT now(),
    "status" "proposal_status" NOT NULL DEFAULT 'pending',
    "reviewed_by" uuid,
    "reviewed_at" timestamptz,
    "review_notes" text
);
CREATE INDEX "question_bank_proposals_status_idx"
    ON "question_bank_proposals" ("status", "proposed_at");
CREATE INDEX "question_bank_proposals_spec_idx"
    ON "question_bank_proposals" ("specialisation", "band", "level");

-- ----------------------------------------------------------------------------
-- AI spend ledger
-- ----------------------------------------------------------------------------

CREATE TABLE "ai_spend_ledger" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "model" "ai_spend_model" NOT NULL,
    "purpose" "ai_spend_purpose" NOT NULL,
    "input_tokens" integer NOT NULL DEFAULT 0,
    "output_tokens" integer NOT NULL DEFAULT 0,
    "cost_usd_x10000" integer NOT NULL DEFAULT 0,
    "called_at" timestamptz NOT NULL DEFAULT now(),
    "success" boolean NOT NULL DEFAULT true
);
CREATE INDEX "ai_spend_ledger_model_called_idx" ON "ai_spend_ledger" ("model", "called_at");

-- ----------------------------------------------------------------------------
-- Notify log
-- ----------------------------------------------------------------------------

CREATE TABLE "notify_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "severity" "notify_severity" NOT NULL,
    "event_type" text NOT NULL,
    "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "channel" "notify_channel" NOT NULL,
    "delivered_at" timestamptz NOT NULL DEFAULT now(),
    "delivery_status" text NOT NULL DEFAULT 'ok'
);

-- ----------------------------------------------------------------------------
-- Skillboard authoring job queue
--
-- One row per Opus call we plan to make against a skillboard:
--   structure         — generate the skills/tasks/mindsets shape (1 row per board)
--   task_cells        — generate the 15 (band × level) cells for one task
--   cell_regeneration — regenerate one cell after rejection
--
-- A worker (admin UI loop OR Netlify scheduled function) claims one
-- pending row at a time, runs the Opus call via withOpusBudget(),
-- writes the result, and marks the row completed/failed.
-- ----------------------------------------------------------------------------

CREATE TABLE "skillboard_authoring_jobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "skillboard_id" uuid NOT NULL REFERENCES "skillboards"("id") ON DELETE CASCADE,
    "job_type" "authoring_job_type" NOT NULL,
    "task_id" uuid REFERENCES "tasks"("id") ON DELETE CASCADE,
    "level_expectation_id" uuid REFERENCES "level_expectations"("id") ON DELETE CASCADE,
    "status" "authoring_job_status" NOT NULL DEFAULT 'pending',
    "attempt_count" integer NOT NULL DEFAULT 0,
    "last_error" text,
    "claimed_at" timestamptz,
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "result" jsonb,
    "input_tokens" integer,
    "output_tokens" integer,
    "cost_usd_x10000" integer,
    "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "skillboard_authoring_jobs_skillboard_idx"
    ON "skillboard_authoring_jobs" ("skillboard_id", "status");
CREATE INDEX "skillboard_authoring_jobs_pending_idx"
    ON "skillboard_authoring_jobs" ("status", "created_at")
    WHERE "status" = 'pending';

-- ----------------------------------------------------------------------------
-- Lock down the new tables — RLS on, no policies = default deny against
-- the anon / authenticated roles. Drizzle uses the service role via
-- DATABASE_URL so it bypasses RLS; nothing in the app reads these
-- tables via the public anon key.
-- ----------------------------------------------------------------------------

ALTER TABLE "skillboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skillboards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "level_expectations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "level_expectations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "vetted_talent_profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vetted_talent_profile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "validation_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "validation_results" FORCE ROW LEVEL SECURITY;
ALTER TABLE "validation_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "validation_overrides" FORCE ROW LEVEL SECURITY;
ALTER TABLE "learning_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_summaries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "learning_summary_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_summary_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "question_bank_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "question_bank_proposals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ai_spend_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_spend_ledger" FORCE ROW LEVEL SECURITY;
ALTER TABLE "notify_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notify_log" FORCE ROW LEVEL SECURITY;
ALTER TABLE "skillboard_authoring_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skillboard_authoring_jobs" FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- End 0011
-- ============================================================================
