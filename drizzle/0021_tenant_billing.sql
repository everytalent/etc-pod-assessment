-- ============================================================================
-- 0021 — Tenant billing (Phase 4)
-- ============================================================================
-- PRD §1a, §7, §7a. Multi-currency, region-tiered, with subscriptions,
-- top-ups, free trial provisioning, and a full append-only ledger.
--
-- Tables:
--   tenant_billing_balance — one row per tenant. Generation credits +
--                            candidate slots. Active subscription FK.
--                            Footer-removal enterprise add-on flags.
--   tenant_subscription    — one active row per tenant (status=active),
--                            historical rows preserved (status=cancelled).
--   tenant_billing_ledger  — append-only event log. Every credit/slot
--                            mutation + every purchase writes a row.
--   fx_rate_snapshot       — daily FX rate captures so historical
--                            charges retain their NGN-equivalent for
--                            ETC reporting.
--   system_config          — single-row-per-key. pricing_tier flips
--                            between launch_promo/standard; launch_date_at
--                            stamps the moment ETC officially launches.
--   tenant_settings        — per-tenant prefs (default_link_expiry_days).
--
-- Integrity: balance mutations live in lib/tenant/billing/*.ts; every
-- mutation writes BOTH a balance UPDATE and a ledger INSERT inside the
-- same transaction. A reconciliation job (deferred) compares balance
-- state to ledger sum nightly.
-- ============================================================================

CREATE TYPE "tenant_subscription_tier" AS ENUM (
  'starter',
  'growth'
);

CREATE TYPE "tenant_subscription_status" AS ENUM (
  'active',
  'cancelled',
  'past_due'
);

CREATE TYPE "tenant_billing_event_type" AS ENUM (
  'trial_provisioned',
  'generation_consumed',
  'generation_refunded',
  'slot_consumed',
  'slot_refunded',
  'generation_purchase',
  'slot_purchase',
  'subscription_renewed',
  'subscription_cancelled',
  'footer_addon_purchase',
  'expiry_credit_aged_out',
  'expiry_slot_aged_out'
);

CREATE TYPE "tenant_payment_processor" AS ENUM (
  'paystack',
  'stripe',
  'manual'
);

CREATE TABLE "tenant_billing_balance" (
  "tenant_id"                  uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "generation_credits"         integer NOT NULL DEFAULT 0,
  "candidate_slots"            integer NOT NULL DEFAULT 0,
  "trial_consumed"             boolean NOT NULL DEFAULT false,
  "active_subscription_id"     uuid,
  "footer_removal_active"      boolean NOT NULL DEFAULT false,
  "footer_removal_expires_at"  timestamptz,
  "updated_at"                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "tenant_subscription" (
  "id"                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                         uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "tier"                              tenant_subscription_tier NOT NULL,
  "status"                            tenant_subscription_status NOT NULL DEFAULT 'active',
  "monthly_amount_local"              numeric NOT NULL,
  "currency_code"                     text NOT NULL,
  "monthly_amount_ngn_equivalent"     numeric NOT NULL,
  "generation_credits_per_cycle"      integer NOT NULL,
  "candidate_slots_per_cycle"         integer NOT NULL,
  "payment_processor"                 tenant_payment_processor NOT NULL,
  "payment_processor_subscription_ref" text,
  "starts_at"                         timestamptz NOT NULL DEFAULT now(),
  "next_renewal_at"                   timestamptz NOT NULL,
  "cancelled_at"                      timestamptz,
  "created_at"                        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_subscription_tenant_idx"
  ON "tenant_subscription"("tenant_id");
CREATE INDEX "tenant_subscription_status_idx"
  ON "tenant_subscription"("status");

ALTER TABLE "tenant_billing_balance"
  ADD CONSTRAINT "tenant_billing_balance_subscription_fk"
  FOREIGN KEY ("active_subscription_id")
  REFERENCES "tenant_subscription"("id") ON DELETE SET NULL;

CREATE TABLE "fx_rate_snapshot" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "currency_code"  text NOT NULL,
  "rate_to_ngn"    numeric NOT NULL,
  "snapshot_at"    timestamptz NOT NULL DEFAULT now(),
  "source"         text NOT NULL DEFAULT 'manual'
);

CREATE INDEX "fx_rate_snapshot_currency_idx"
  ON "fx_rate_snapshot"("currency_code", "snapshot_at" DESC);

CREATE TABLE "tenant_billing_ledger" (
  "id"                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"                       uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_type"                      tenant_billing_event_type NOT NULL,
  "generation_credits_delta"        integer NOT NULL DEFAULT 0,
  "candidate_slots_delta"           integer NOT NULL DEFAULT 0,
  "related_assessment_bank_id"      uuid REFERENCES "tenant_assessment_bank"("id") ON DELETE SET NULL,
  "related_candidate_assessment_id" uuid,
  "payment_processor"               tenant_payment_processor,
  "payment_processor_ref"           text,
  "amount_local"                    numeric,
  "currency_code"                   text,
  "amount_ngn_at_time"              numeric,
  "fx_rate_snapshot_id"             uuid REFERENCES "fx_rate_snapshot"("id") ON DELETE SET NULL,
  "pricing_tier_at_purchase"        text,
  "reason"                          text,
  "created_at"                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_billing_ledger_tenant_idx"
  ON "tenant_billing_ledger"("tenant_id", "created_at" DESC);
CREATE INDEX "tenant_billing_ledger_event_type_idx"
  ON "tenant_billing_ledger"("event_type");

CREATE TABLE "system_config" (
  "key"             text PRIMARY KEY,
  "value_text"      text,
  "value_timestamp" timestamptz,
  "value_numeric"   numeric,
  "updated_by"      uuid,
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO "system_config" ("key", "value_text")
  VALUES ('pricing_tier', 'launch_promo')
  ON CONFLICT ("key") DO NOTHING;

INSERT INTO "system_config" ("key", "value_numeric")
  VALUES ('similarity_threshold', 0.78)
  ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "tenant_settings" (
  "tenant_id"                  uuid PRIMARY KEY REFERENCES "tenants"("id") ON DELETE CASCADE,
  "default_link_expiry_days"   integer NOT NULL DEFAULT 30,
  "updated_at"                 timestamptz NOT NULL DEFAULT now()
);
