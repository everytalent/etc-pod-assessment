-- ============================================================================
-- 0024 — Expanded tenant_assessment_branding fields
-- ============================================================================
-- Brings the tenant brand surface to parity with JD Studio's brand
-- panel: support email, company URL, footer text, contact email/phone,
-- text mark fallback, primary text colour, "Powered by ETC" toggle.
--
-- All columns are nullable / sensibly defaulted so existing rows keep
-- rendering unchanged.
-- ============================================================================

ALTER TABLE "tenant_assessment_branding"
  ADD COLUMN IF NOT EXISTS "support_email" text,
  ADD COLUMN IF NOT EXISTS "company_url" text,
  ADD COLUMN IF NOT EXISTS "footer_text" text,
  ADD COLUMN IF NOT EXISTS "contact_email" text,
  ADD COLUMN IF NOT EXISTS "contact_phone" text,
  ADD COLUMN IF NOT EXISTS "text_mark" text,
  ADD COLUMN IF NOT EXISTS "primary_text_color" text NOT NULL DEFAULT '#020301',
  ADD COLUMN IF NOT EXISTS "show_powered_by_etc" boolean NOT NULL DEFAULT true;
