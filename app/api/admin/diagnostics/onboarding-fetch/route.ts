/**
 * GET /api/admin/diagnostics/onboarding-fetch?candidate_id=ETC-00145
 *
 * Smoke-test endpoint for the Onboarding HTTP client. Returns either:
 *   - The full OnboardingProfile fetched from Railway (success)
 *   - A structured error describing why the fetch failed
 *
 * Used to verify ONBOARDING_API_URL + ETC_ASSESSMENT_SERVICE_TOKEN
 * are correctly configured on Netlify without having to spin up a
 * full validation flow.
 *
 * Permission: superadmin (it can hit external services with secrets).
 */

import { NextResponse } from "next/server";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { getOnboardingProfile } from "@/lib/engines/assessment/onboarding-client";

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const candidateId = searchParams.get("candidate_id");
  if (!candidateId) {
    return NextResponse.json(
      { error: "missing_candidate_id", message: "Pass ?candidate_id=ETC-xxxxx" },
      { status: 400 },
    );
  }

  const env = {
    ONBOARDING_API_URL_set: !!process.env.ONBOARDING_API_URL,
    ETC_ASSESSMENT_SERVICE_TOKEN_set:
      !!process.env.ETC_ASSESSMENT_SERVICE_TOKEN,
    using_path: process.env.ONBOARDING_API_URL ? "live" : "local_shim",
  };

  try {
    const profile = await getOnboardingProfile(candidateId);
    return NextResponse.json({
      ok: true,
      env,
      profile,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        env,
        error_class: err instanceof Error ? err.constructor.name : "unknown",
        message: err instanceof Error ? err.message : "fetch_failed",
      },
      { status: 502 },
    );
  }
}
