-- =============================================================================
-- 2026-06-18 — Backfill question_seed jobs for already-activated boards
-- =============================================================================
-- After commit X, the activate route auto-enqueues seed jobs for every
-- (band × level × task) cell. But the 4 boards that were activated
-- BEFORE that change have nearly-empty validation banks and need a
-- one-time backfill.
--
-- This script inserts one `question_seed` job per cell × band × level
-- for every active, non-archived board. The worker picks them up on
-- the next poll (or Netlify cron tick) and runs them in parallel,
-- auto-approving each question into the validation bank.
--
-- Cost: ~$0.05 per cell. A typical board has 27 tasks × 3 bands ×
-- 5 levels = 405 cells = ~$20 per board. With 4 boards that's ~$80
-- of Opus credit. Time: ~30-60 minutes per board on a single worker;
-- proportionally faster with concurrent workers + cron ticks.
--
-- SAFE to re-run — skips boards that already have >= 30 questions in
-- their validation bank (presumed "seeded enough"). Adjust the
-- threshold by editing the HAVING clause.
-- =============================================================================

BEGIN;

WITH eligible AS (
  -- Activated, not-archived boards whose validation bank has < 30 questions.
  SELECT sb.id            AS skillboard_id,
         sb.specialisation AS spec
  FROM   skillboards sb
  LEFT JOIN assessments a
    ON   a.mode = 'validation'
    AND  a.specialisation = sb.specialisation
  LEFT JOIN questions q
    ON   q.assessment_id = a.id
  WHERE  sb.activated_at IS NOT NULL
    AND  sb.archived_at  IS NULL
  GROUP  BY sb.id, sb.specialisation
  HAVING COUNT(q.id) < 30
),
cells AS (
  -- All (skillboard, task, band, level) cells for those boards.
  SELECT e.skillboard_id,
         e.spec,
         t.id AS task_id,
         band,
         level
  FROM   eligible e
  JOIN   skills s  ON s.skillboard_id = e.skillboard_id
  JOIN   tasks  t  ON t.skill_id      = s.id
  CROSS  JOIN UNNEST(ARRAY['junior','mid','senior']::seniority_band[])   AS band
  CROSS  JOIN UNNEST(ARRAY['below','nh','g','p','tp']::performance_level[]) AS level
)
INSERT INTO skillboard_authoring_jobs
  (skillboard_id, job_type, task_id, status, paused_until_review, result)
SELECT skillboard_id,
       'question_seed'::authoring_job_type,
       task_id,
       'pending'::authoring_job_status,
       false,
       jsonb_build_object(
         'specialisation',   spec,
         'band',             band::text,
         'level',            level::text,
         'task_id',          task_id::text,
         'questions_per_cell', 3,
         'auto_approve',     true
       )
FROM cells;

COMMIT;

-- ---------- Verify ----------
-- Expected: a row per (board × cell) you just enqueued. Worker will
-- drain it over the next 30-60 min per board.
SELECT skillboard_id, COUNT(*) AS jobs_enqueued
FROM   skillboard_authoring_jobs
WHERE  job_type = 'question_seed'
  AND  status = 'pending'
GROUP  BY skillboard_id;
