-- ============================================================================
-- 0027 — Tenant table hardening
-- ============================================================================
-- The tenant-owned tables were created prior to the Supabase security review and
-- were left with RLS disabled. These tables are tenant-scoped and should default
-- to deny-all unless a specific policy is added later.
--
-- The app authenticates with the server-side Postgres role and service-role
-- bypasses through the direct DB connection, so this is the safe baseline
-- enforcement that satisfies Supabase Security Advisor without breaking the
-- server-side business logic.
-- ============================================================================

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_assessment_branding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_assessment_bank" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_assessment_draft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_billing_balance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fx_rate_snapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_billing_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
