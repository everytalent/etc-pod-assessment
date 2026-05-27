-- ============================================================================
-- 0012 — candidate_profiles shim (Phase 7 / Onboarding interface stub)
-- ============================================================================
-- This table is a LOCAL DEV STAND-IN for the Onboarding Engine.
--
-- In production, the Onboarding Engine (podsproject on Railway) writes the
-- canonical talent profile. The Assessment Engine reads it via the
-- cross-engine HTTP contract at /api/internal/candidates/[id]/profile.
--
-- Until that integration ships, we let an admin manually author profiles
-- here through /admin/candidate-profiles. The HTTP endpoint above falls
-- back to reading this table when ONBOARDING_API_URL is unset.
--
-- Drop this table once the real Onboarding Engine is wired.
-- ============================================================================

CREATE TABLE "candidate_profiles" (
    "candidate_id" text PRIMARY KEY,
    "profile_json" jsonb NOT NULL,
    "created_by" uuid REFERENCES "admin_users"("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "candidate_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_profiles" FORCE ROW LEVEL SECURITY;
