/**
 * Onboarding Engine HTTP client.
 *
 * The Validation Engine reads candidate profiles via this client only.
 * Direct DB joins into Onboarding's `talent_profiles` are banned by
 * the architecture principle ([[etc-engine-taxonomy]]), even when both
 * engines share a Postgres instance.
 *
 * Today the implementation is a stub that reads from a small
 * `candidate_profiles` shim populated manually (or via an admin form).
 * Once the Onboarding Engine API is reachable from this app, swap the
 * implementation to a fetch against `${ONBOARDING_API_URL}/api/internal/
 * candidates/${id}/profile` — the public function shape stays the same
 * so call sites don't change.
 *
 * Service-token auth: when we wire the real API, every call carries
 * `Authorization: Bearer ${ETC_ASSESSMENT_SERVICE_TOKEN}`. Onboarding
 * verifies the token against its allowlist before responding.
 */

import type { OnboardingProfile } from "./types";

const ONBOARDING_API_URL = process.env.ONBOARDING_API_URL;
const SERVICE_TOKEN = process.env.ETC_ASSESSMENT_SERVICE_TOKEN;

export class OnboardingProfileNotFoundError extends Error {
  constructor(public readonly candidateId: string) {
    super(`Onboarding profile not found: ${candidateId}`);
    this.name = "OnboardingProfileNotFoundError";
  }
}

/**
 * Fetch a candidate's onboarding profile by ETC-XXXXX id.
 *
 * Returns `null` if the candidate doesn't exist in Onboarding. Throws
 * on transport / auth failures so the caller can surface them rather
 * than silently behaving as if the candidate were absent.
 */
export async function getOnboardingProfile(
  candidateId: string,
): Promise<OnboardingProfile | null> {
  // Phase 0 stub: read from the local `candidate_profiles` shim if no
  // Onboarding API URL is configured. This lets the admin team author
  // test profiles for development without waiting on the cross-engine
  // wiring.
  if (!ONBOARDING_API_URL) {
    return readLocalShim(candidateId);
  }

  if (!SERVICE_TOKEN) {
    throw new Error(
      "ETC_ASSESSMENT_SERVICE_TOKEN is required when ONBOARDING_API_URL is set",
    );
  }

  const url = `${ONBOARDING_API_URL.replace(/\/$/, "")}/api/internal/candidates/${encodeURIComponent(candidateId)}/profile`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Onboarding profile fetch ${res.status}: ${text || res.statusText}`,
    );
  }

  return (await res.json()) as OnboardingProfile;
}

/* ---------- Local shim (replaced by real API in production) ---------- */

/**
 * Phase 0 stub: returns a profile if an admin authored one through the
 * forthcoming `/admin/candidate-profiles` page. Until that page exists,
 * this returns null and the validation flow can't start — which is the
 * correct behaviour, not a silent fallback.
 *
 * Long-term: deleted once `ONBOARDING_API_URL` is wired in production.
 */
async function readLocalShim(
  candidateId: string,
): Promise<OnboardingProfile | null> {
  // Importing db here (not at top of file) keeps this whole module
  // tree-shakeable in environments that don't hit it.
  const { db } = await import("@/lib/db/client");
  const { sql } = await import("drizzle-orm");
  try {
    const rows = await db.execute(
      sql`SELECT profile_json FROM candidate_profiles WHERE candidate_id = ${candidateId} LIMIT 1`,
    );
    const first = (rows as unknown as { rows: { profile_json: unknown }[] })
      .rows?.[0];
    if (!first) return null;
    return first.profile_json as OnboardingProfile;
  } catch {
    // Shim table doesn't exist yet — that's fine in early dev. Caller
    // sees null and can guide the user to author one.
    return null;
  }
}
