-- =============================================================================
-- 2026-06-18 — Rename skillboards to match Onboarding's canonical labels
-- =============================================================================
-- One-off cleanup, NOT a Drizzle migration. Run in Supabase SQL Editor.
-- Safe to re-run (idempotent — only updates rows where the current name
-- doesn't already match the target).
--
-- Context: the Assessment engine's sessions endpoint looks up skillboards
-- by exact `specialisation` string match. Onboarding sends labels from a
-- fixed dropdown (see podsproject's specialisations.ts). Existing
-- skillboards were named slightly differently by Learning Experts at
-- creation time, so candidates were getting blocked.
--
-- The new specialisation-matcher.ts handles case + suffix drift
-- automatically, so this rename isn't strictly necessary for matching to
-- succeed. We do it anyway for HYGIENE: the admin UI shows the stored
-- name, and aligning it with what candidates see in onboarding makes the
-- whole system easier to reason about.
-- =============================================================================

BEGIN;

-- 1. Solar installation specialist → Solar Installation
UPDATE skillboards
SET specialisation = 'Solar Installation',
    updated_at = now()
WHERE specialisation = 'Solar installation specialist';

-- 2. Project Engineer → Project Engineering
UPDATE skillboards
SET specialisation = 'Project Engineering',
    updated_at = now()
WHERE specialisation = 'Project Engineer';

-- 3. Solar Design Specialist → System Design
UPDATE skillboards
SET specialisation = 'System Design',
    updated_at = now()
WHERE specialisation = 'Solar Design Specialist';

-- 4. Solar Sales Specialist → Business Development / Sales (keep, as it's
--    the newer/actively-authored one with full board content)
UPDATE skillboards
SET specialisation = 'Business Development / Sales',
    updated_at = now()
WHERE specialisation = 'Solar Sales Specialist';

-- 5. Archive the older Solar Sales duplicate (do NOT delete — preserves
--    history for any candidates who already took an assessment against it).
--    The archive sets activated_at to NULL effectively and excludes it
--    from new session matching via the activatedAt + archivedAt check.
UPDATE skillboards
SET archived_at = now(),
    updated_at = now()
WHERE specialisation = 'Solar Sales'
  AND archived_at IS NULL;

-- 6. (Optional, not destructive) If any sentinel "Validation Bank — <old>"
--    assessments existed for the renamed specs, rename them to match.
--    The getOrCreateValidationBank() helper looks them up by the new
--    skillboard name; mismatched ones would otherwise create a second
--    bank with the new name and leave the old empty.
UPDATE assessments
SET specialisation = 'Solar Installation',
    title = 'Validation Bank — Solar Installation'
WHERE specialisation = 'Solar installation specialist'
  AND mode = 'validation';

UPDATE assessments
SET specialisation = 'Project Engineering',
    title = 'Validation Bank — Project Engineering'
WHERE specialisation = 'Project Engineer'
  AND mode = 'validation';

UPDATE assessments
SET specialisation = 'System Design',
    title = 'Validation Bank — System Design'
WHERE specialisation = 'Solar Design Specialist'
  AND mode = 'validation';

UPDATE assessments
SET specialisation = 'Business Development / Sales',
    title = 'Validation Bank — Business Development / Sales'
WHERE specialisation = 'Solar Sales Specialist'
  AND mode = 'validation';

COMMIT;

-- =============================================================================
-- Verification — run these after the COMMIT to confirm the new state.
-- =============================================================================

-- Expected: 4 active rows aligned to Onboarding labels, 1 archived
-- (Solar Sales), plus Recruitment Consultant + tenant variants untouched.
SELECT specialisation,
       activated_at IS NOT NULL AS active,
       archived_at  IS NOT NULL AS archived,
       updated_at
FROM skillboards
ORDER BY archived_at NULLS FIRST, specialisation;
