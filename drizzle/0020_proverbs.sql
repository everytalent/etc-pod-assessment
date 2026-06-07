-- ============================================================================
-- 0020 — Proverb Engine (PRD §3, Phase 3)
-- ============================================================================
-- Tagged library that powers the wait-screen rotation while a tenant
-- generation job is running. Each proverb is tagged against one or
-- more tenant-visible stages (reading_role / calibrating / crafting /
-- finalising); the client polls /api/v1/proverbs/next?stage=X&seen=...
-- and the response excludes anything in `seen` so no proverb repeats
-- within a single wait session.
--
-- Seeded via a separate scripts/seed-proverbs.ts (Phase 3 ships with
-- 24 proverbs across Yoruba, Igbo, Hausa, Swahili, Zulu).
-- ============================================================================

CREATE TABLE "proverb" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "language"              text NOT NULL,
  "original_text"         text NOT NULL,
  "transliteration"       text,
  "english_translation"   text NOT NULL,
  "stages"                jsonb NOT NULL DEFAULT '[]'::jsonb,
  "contextual_note"       text NOT NULL DEFAULT '',
  "source_attribution"    text,
  "active"                boolean NOT NULL DEFAULT true,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "proverb_active_idx" ON "proverb"("active");
CREATE INDEX "proverb_language_idx" ON "proverb"("language");
