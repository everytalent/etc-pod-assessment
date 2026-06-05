-- ============================================================================
-- 0015 — skillboards.archived_at (soft delete)
-- ============================================================================
-- Adds a soft-delete column to skillboards. Archived boards stay in the
-- DB (so historical responses still resolve their associated skills/
-- tasks/cells), but are hidden from the default admin list and from
-- POST /api/internal/sessions resolution.
--
-- Why soft-delete instead of hard-delete: vetted_talent_profile rows
-- and historical responses reference skillboard structure indirectly
-- via the sentinel "Validation Bank — <spec>" assessment + its
-- questions. Hard-deleting a skillboard would orphan that history.
-- ============================================================================

ALTER TABLE "skillboards"
    ADD COLUMN "archived_at" timestamptz;

CREATE INDEX "skillboards_archived_at_idx"
    ON "skillboards" ("archived_at")
    WHERE "archived_at" IS NULL;
