-- =============================================================================
-- 2026-06-18 — Backfill bank_seed jobs for already-activated boards
-- =============================================================================
-- The 4 boards activated before today's auto-seed change have nearly-
-- empty banks. This script enqueues seed jobs for each, scoped CHEAP
-- to keep cost low while getting candidates through the flow.
--
-- Strategy: seed all 3 bands but ONLY at the "Growing" (g) level.
-- The CAT picker's neighbour-band + neighbour-level fallback (added
-- 2026-06-18) means a candidate at any band/level can still reach
-- these questions. Once a candidate completes a session you can
-- decide whether to add more cells.
--
-- Cost:  ~25 tasks × 3 bands × 1 level × 3 questions × $0.05 ≈ $11/board
-- Total: 4 boards × ~$11 ≈ ~$45  (vs ~$80 for full coverage)
--
-- SAFE to re-run — skips boards that already have ≥ 30 questions in
-- their validation bank.
-- =============================================================================

BEGIN;

WITH eligible AS (
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
  SELECT e.skillboard_id,
         e.spec,
         t.id AS task_id,
         band
  FROM   eligible e
  JOIN   skills s  ON s.skillboard_id = e.skillboard_id
  JOIN   tasks  t  ON t.skill_id      = s.id
  CROSS  JOIN UNNEST(ARRAY['junior','mid','senior']::seniority_band[]) AS band
)
INSERT INTO skillboard_authoring_jobs
  (skillboard_id, job_type, task_id, status, paused_until_review, result)
SELECT skillboard_id,
       'bank_seed'::authoring_job_type,
       task_id,
       'pending'::authoring_job_status,
       false,
       jsonb_build_object(
         'specialisation',     spec,
         'band',               band::text,
         'level',              'g',
         'task_id',            task_id::text,
         'questions_per_cell', 3,
         'auto_approve',       true
       )
FROM cells;

COMMIT;

-- ---------- Verify ----------
SELECT sb.specialisation,
       COUNT(*) AS jobs_enqueued
FROM   skillboard_authoring_jobs j
JOIN   skillboards sb ON sb.id = j.skillboard_id
WHERE  j.job_type = 'bank_seed'
  AND  j.status   = 'pending'
GROUP  BY sb.specialisation
ORDER  BY sb.specialisation;
