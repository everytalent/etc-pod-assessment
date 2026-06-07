-- ============================================================================
-- 0018 — Tenant assessment branding (Phase 1)
-- ============================================================================
-- PRD §0b. Brand customisation captured during first-run onboarding and
-- editable via /tenant/settings/branding. Read by:
--   - the tenant admin live-preview pane
--   - <TenantThemeProvider /> on /tenant pages
--   - the candidate-facing runner (/take/[token]) to skin candidate UI
--
-- onboarding_completed_at controls the "show onboarding cards first" gate
-- on /tenant/assessments/new; null = first visit, show the carousel.
-- ============================================================================

CREATE TABLE "tenant_assessment_branding" (
  "tenant_id"                uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "primary_color"            text NOT NULL DEFAULT '#f1b240',  -- ETC orange
  "accent_color"             text NOT NULL DEFAULT '#020301',  -- ETC black
  "logo_url"                 text,
  "onboarding_completed_at"  timestamptz,
  "updated_by_user_id"       uuid REFERENCES "tenant_users"("id") ON DELETE SET NULL,
  "updated_at"               timestamptz NOT NULL DEFAULT now()
);
