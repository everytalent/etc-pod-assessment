-- ============================================================================
-- 0022 — Tenant results: overrides, IP detection, candidate findings
-- ============================================================================
-- PRD §5 + §5a. Per-question scoring transparency + override pipeline +
-- same-IP detector backing for the integrity findings.
-- ============================================================================

CREATE TYPE "candidate_override_reason" AS ENUM (
  'too_harsh',
  'too_lenient',
  'missed_context',
  'cultural_nuance',
  'translation_issue',
  'other'
);

CREATE TABLE "candidate_response_override" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "response_id"                 uuid NOT NULL REFERENCES "responses"("id") ON DELETE CASCADE,
  "answer_id"                   uuid REFERENCES "answers"("id") ON DELETE CASCADE,
  "question_id"                 uuid NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "overridden_by_user_id"       uuid NOT NULL REFERENCES "tenant_users"("id") ON DELETE RESTRICT,
  "tenant_id"                   uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "original_score"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "new_score"                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reason_category"             candidate_override_reason NOT NULL,
  "reason_text"                 text NOT NULL,
  "reverted_at"                 timestamptz,
  "created_at"                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "candidate_response_override_response_idx"
  ON "candidate_response_override"("response_id");
CREATE INDEX "candidate_response_override_question_idx"
  ON "candidate_response_override"("question_id");
CREATE INDEX "candidate_response_override_tenant_idx"
  ON "candidate_response_override"("tenant_id");

-- Same-IP candidate clustering. Phase 5 captures the IP on each
-- response.metadata.candidate_ip_address; Phase 6 detects clusters
-- within the same tenant_assessment_bank and writes a row here so
-- the integrity-findings translator can name the cross-candidate.
CREATE TABLE "candidate_ip_match" (
  "id"                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_assessment_bank_id"       uuid NOT NULL REFERENCES "tenant_assessment_bank"("id") ON DELETE CASCADE,
  "response_a_id"                   uuid NOT NULL REFERENCES "responses"("id") ON DELETE CASCADE,
  "response_b_id"                   uuid NOT NULL REFERENCES "responses"("id") ON DELETE CASCADE,
  "shared_ip_address"               text NOT NULL,
  "detected_at"                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "candidate_ip_match_bank_idx"
  ON "candidate_ip_match"("tenant_assessment_bank_id");
CREATE INDEX "candidate_ip_match_response_a_idx"
  ON "candidate_ip_match"("response_a_id");
CREATE INDEX "candidate_ip_match_response_b_idx"
  ON "candidate_ip_match"("response_b_id");
