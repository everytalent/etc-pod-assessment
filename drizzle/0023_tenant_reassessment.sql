-- ============================================================================
-- 0023 — Tenant reassessment (PRD §6)
-- ============================================================================
-- 1 reassessment per candidate per tenant_assessment_bank in v1 (audit
-- logged). The original response is preserved; the reassessment row
-- references the original_response_id so the UI can render side-by-side.
-- ============================================================================

CREATE TABLE "candidate_reassessment" (
  "id"                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_assessment_bank_id"         uuid NOT NULL REFERENCES "tenant_assessment_bank"("id") ON DELETE CASCADE,
  "original_response_id"              uuid NOT NULL REFERENCES "responses"("id") ON DELETE CASCADE,
  "reassessment_response_id"          uuid REFERENCES "responses"("id") ON DELETE SET NULL,
  "triggered_by_user_id"              uuid NOT NULL REFERENCES "tenant_users"("id") ON DELETE RESTRICT,
  "excluded_question_ids"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "triggered_at"                      timestamptz NOT NULL DEFAULT now(),
  "completed_at"                      timestamptz
);

CREATE UNIQUE INDEX "candidate_reassessment_one_per_original_uniq"
  ON "candidate_reassessment"("original_response_id");
CREATE INDEX "candidate_reassessment_bank_idx"
  ON "candidate_reassessment"("tenant_assessment_bank_id");
