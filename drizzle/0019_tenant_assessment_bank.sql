-- ============================================================================
-- 0019 — Tenant assessment bank + drafts + provisional skillboards
-- ============================================================================
-- PRD §1, §2, "Data model changes". Lands the tables that hold the
-- tenant-driven assessment-creation flow and the columns the engine
-- needs to (a) treat provisional skillboards exactly like
-- Learning-Expert-authored ones at runtime while (b) keeping the
-- lineage visible to the LE queue.
--
-- New columns on existing tables:
--   skillboards:    provisional, derived_from, originating_tenant_id,
--                   last_reviewed_by_le_at
--   questions:      tenant_authored, treatment, original_text,
--                   sample, sample_for_bank_id
--
-- Tenant question treatment: 'use_as_is' inserts the tenant's wording
-- verbatim; 'improve' lets the algorithm rewrite it (preserving
-- original_text alongside for audit + the "From you (refined)" tooltip).
--
-- Drafts hold an in-flight intake when the post-intake payment gate
-- blocks generation. 24h retention enforced at the application layer.
-- ============================================================================

CREATE TYPE "tenant_intake_type" AS ENUM (
  'job_description',
  'scope_of_work'
);

CREATE TYPE "tenant_intake_source" AS ENUM (
  'paste',
  'upload'
);

CREATE TYPE "tenant_question_treatment" AS ENUM (
  'use_as_is',
  'improve',
  'algorithm_generated'
);

CREATE TYPE "tenant_assessment_bank_status" AS ENUM (
  'queued',
  'analysing',
  'calibrating',
  'crafting',
  'finalising',
  'ready',
  'failed'
);

CREATE TYPE "tenant_assessment_route" AS ENUM (
  'match',
  'provisional',
  'failed'
);

CREATE TYPE "tenant_draft_reason" AS ENUM (
  'awaiting_payment'
);

-- ---------- skillboards: provisional lineage + LE-review marker -------------
ALTER TABLE "skillboards"
  ADD COLUMN "provisional" boolean NOT NULL DEFAULT false;
ALTER TABLE "skillboards"
  ADD COLUMN "derived_from" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "skillboards"
  ADD COLUMN "originating_tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL;
ALTER TABLE "skillboards"
  ADD COLUMN "last_reviewed_by_le_at" timestamptz;

CREATE INDEX "skillboards_provisional_idx" ON "skillboards"("provisional");
CREATE INDEX "skillboards_originating_tenant_idx"
  ON "skillboards"("originating_tenant_id");

-- The legacy unique constraint on skillboards.specialisation is incompatible
-- with provisional rows: multiple tenants may need a provisional row for
-- "Solar Design Specialist". Switch to a partial unique covering only the
-- master library (provisional = false). The application enforces uniqueness
-- of (specialisation, originating_tenant_id) for provisional rows.
ALTER TABLE "skillboards" DROP CONSTRAINT IF EXISTS "skillboards_specialisation_unique";
CREATE UNIQUE INDEX "skillboards_specialisation_master_uniq"
  ON "skillboards"("specialisation")
  WHERE "provisional" = false;
CREATE UNIQUE INDEX "skillboards_specialisation_per_tenant_uniq"
  ON "skillboards"("specialisation", "originating_tenant_id")
  WHERE "provisional" = true;

-- skillboard_creation_path needs a tenant_builder value so admin tooling
-- can filter provisional rows by their origin path.
ALTER TYPE "skillboard_creation_path" ADD VALUE IF NOT EXISTS 'tenant_builder';

-- ---------- questions: tenant authorship + sample-bank ----------------------
ALTER TABLE "questions"
  ADD COLUMN "tenant_authored" boolean NOT NULL DEFAULT false;
ALTER TABLE "questions"
  ADD COLUMN "treatment" tenant_question_treatment;
ALTER TABLE "questions"
  ADD COLUMN "original_text" text;
ALTER TABLE "questions"
  ADD COLUMN "sample" boolean NOT NULL DEFAULT false;
-- sample_for_bank_id FK added after tenant_assessment_bank below.

-- ---------- tenant_assessment_bank ------------------------------------------
CREATE TABLE "tenant_assessment_bank" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                   uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_by_user_id"          uuid NOT NULL REFERENCES "tenant_users"("id") ON DELETE RESTRICT,
  "intake_type"                 tenant_intake_type NOT NULL,
  "intake_text"                 text NOT NULL,
  "intake_text_hash"            text NOT NULL,
  "intake_source"               tenant_intake_source NOT NULL DEFAULT 'paste',
  "intake_upload_filename"      text,
  "context_text"                text,
  "tenant_supplied_questions"   jsonb,
  "sample_preview_question_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Internal-only fields. Stripped by lib/tenant/serialiser.ts before any
  -- tenant-facing payload leaves the server.
  "route_taken"                 tenant_assessment_route,
  "source_skillboard_id"        uuid REFERENCES "skillboards"("id") ON DELETE SET NULL,
  "provisional_framework_id"    uuid REFERENCES "skillboards"("id") ON DELETE SET NULL,
  "status"                      tenant_assessment_bank_status NOT NULL DEFAULT 'queued',
  "assessment_link_token"       text UNIQUE,
  "link_expires_at"             timestamptz,
  "cost_usd"                    numeric,
  "duration_ms"                 integer,
  "failure_reason"              text,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_assessment_bank_tenant_idx"
  ON "tenant_assessment_bank"("tenant_id");
CREATE INDEX "tenant_assessment_bank_status_idx"
  ON "tenant_assessment_bank"("status");
CREATE INDEX "tenant_assessment_bank_intake_hash_idx"
  ON "tenant_assessment_bank"("intake_text_hash");

ALTER TABLE "questions"
  ADD COLUMN "sample_for_bank_id" uuid REFERENCES "tenant_assessment_bank"("id") ON DELETE SET NULL;
CREATE INDEX "questions_sample_for_bank_idx" ON "questions"("sample_for_bank_id");
CREATE INDEX "questions_tenant_authored_idx" ON "questions"("tenant_authored");

-- ---------- tenant_assessment_draft -----------------------------------------
CREATE TABLE "tenant_assessment_draft" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                  uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "created_by_user_id"         uuid NOT NULL REFERENCES "tenant_users"("id") ON DELETE RESTRICT,
  "intake_type"                tenant_intake_type NOT NULL,
  "intake_text"                text NOT NULL,
  "context_text"               text,
  "tenant_supplied_questions"  jsonb,
  "reason_for_draft"           tenant_draft_reason NOT NULL,
  "expires_at"                 timestamptz NOT NULL,
  "created_at"                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_assessment_draft_tenant_idx"
  ON "tenant_assessment_draft"("tenant_id");
CREATE INDEX "tenant_assessment_draft_expires_idx"
  ON "tenant_assessment_draft"("expires_at");
