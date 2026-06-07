-- ============================================================================
-- 0017 — Tenant foundation
-- ============================================================================
-- First slice of the tenant-facing assessment builder (PRD
-- 2026-06-02-tenant-assessment-builder.md).
--
-- Phase 0 lands:
--   tenants            — one row per paying organisation. Country is locked
--                        at signup; currency + pricing_tier derive from it.
--   tenant_users       — Supabase-auth allowlist scoped to a single tenant.
--                        Mirrors admin_users but with a tenant FK.
--
-- Brand, billing, assessment-bank, proverbs, etc. follow in later migrations
-- as the corresponding phases land. Kept narrow on purpose so the foundation
-- can ship and be exercised before the rest of the surface goes in.
-- ============================================================================

CREATE TYPE "tenant_pricing_tier" AS ENUM (
  'nigeria',
  'international',
  'us'
);

CREATE TYPE "tenant_role" AS ENUM (
  'owner',
  'admin',
  'member'
);

CREATE TABLE "tenants" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"           text NOT NULL,
  -- ISO 3166-1 alpha-2 for Nigeria/UK/Canada/UAE/US; 'XK' is our internal
  -- sentinel for the Caribbean grouping in the PRD (no single ISO code).
  "country_code"   text NOT NULL,
  "currency_code"  text NOT NULL,
  "pricing_tier"   tenant_pricing_tier NOT NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "tenant_users" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"      uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "email"          text NOT NULL UNIQUE,
  "role"           tenant_role NOT NULL DEFAULT 'member',
  "invited_by"     uuid REFERENCES "tenant_users"("id") ON DELETE SET NULL,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_users_tenant_id_idx" ON "tenant_users"("tenant_id");
CREATE INDEX "tenant_users_email_lower_idx" ON "tenant_users"(lower("email"));
