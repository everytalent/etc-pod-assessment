-- ============================================================================
-- 0014 — Add 'bank_seed' to authoring_job_type enum
-- ============================================================================
-- Netlify caps Next.js serverless functions at ~30s on standard plans,
-- and the Opus seed call routinely runs longer. We move the test-seed
-- flow to the same async job pattern that handles 'structure',
-- 'task_cells', and 'cell_regeneration'.
--
-- After this migration:
--   - POST /api/admin/skillboards/[id]/test-seed enqueues 1 bank_seed
--     job per cell and returns immediately
--   - Worker (cron, every 5 min) claims the job, calls
--     seedQuestionsForCell + auto-approves the resulting proposals
-- ============================================================================

ALTER TYPE "authoring_job_type" ADD VALUE IF NOT EXISTS 'bank_seed';
