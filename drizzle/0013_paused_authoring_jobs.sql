-- ============================================================================
-- 0013 — paused_until_review flag on skillboard_authoring_jobs
-- ============================================================================
-- Used by the "Stage regenerations for review" flow in bulk-reject.
-- When a Learning Expert bulk-rejects cells with mode='stage', the
-- regen jobs are inserted with paused_until_review=true. The worker
-- ignores paused jobs; an admin reviews + clicks Start to release
-- (set to false) or Cancel (delete the rows).
-- ============================================================================

ALTER TABLE "skillboard_authoring_jobs"
    ADD COLUMN "paused_until_review" boolean NOT NULL DEFAULT false;

-- Index lets the worker query "pending AND not paused" cheaply.
CREATE INDEX "skillboard_authoring_jobs_pending_active_idx"
    ON "skillboard_authoring_jobs" ("skillboard_id", "status", "paused_until_review");
