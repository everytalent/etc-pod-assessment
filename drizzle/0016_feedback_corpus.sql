-- ============================================================================
-- 0016 — Skillboard feedback corpus + proposal regeneration job type
-- ============================================================================
-- Closes the feedback loop for rejected proposals AND rolls every
-- rejection (cell or proposal) back into a skillboard-level corpus
-- so future generations start with that learning baked in.
--
--   feedback_notes:
--     jsonb array of { at, by, source, notes, context } entries.
--     Read by buildFeedbackContextBlock() and injected into the
--     seed/regen/structure Opus prompts as a "Past reviewer feedback
--     to address" section.
--
--   authoring_job_type: 'proposal_regeneration'
--     New enum value. Mirrors cell_regeneration but operates on a
--     question_bank_proposals row. Worker reads the previous proposal
--     text + rejection notes + corpus, calls Opus, writes a new
--     pending proposal alongside the rejected one.
-- ============================================================================

ALTER TABLE "skillboards"
    ADD COLUMN IF NOT EXISTS "feedback_notes" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TYPE "authoring_job_type" ADD VALUE IF NOT EXISTS 'proposal_regeneration';
