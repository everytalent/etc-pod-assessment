/**
 * GET /api/internal/candidates/[id]/profile
 *
 * The cross-engine contract — Onboarding Engine writes here; Assessment
 * Engine (this app) reads. Today the implementation is a local shim
 * reading from a `candidate_profiles` table populated manually via the
 * admin form. Once Onboarding is wired, this endpoint flips to a
 * pass-through (or stays as a local cache).
 *
 * Auth: service token (Bearer). Shape locked per OnboardingProfile.
 */

import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";

function isValidServiceToken(token: string): boolean {
  if (!token) return false;
  const allowed = (process.env.ETC_PROFILE_SERVICE_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return allowed.includes(token);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!isValidServiceToken(token)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { id } = await context.params;

  // Read from the local shim table — Phase 0 onboarding-client.ts
  // already documents this fallback.
  try {
    const rows = await db.execute(
      sql`SELECT profile_json FROM candidate_profiles WHERE candidate_id = ${id} LIMIT 1`,
    );
    const first = (rows as unknown as { rows: { profile_json: unknown }[] })
      .rows?.[0];
    if (!first) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(first.profile_json);
  } catch {
    return NextResponse.json(
      {
        error: "shim_not_ready",
        message:
          "candidate_profiles shim table not present. Create it or wire ONBOARDING_API_URL to the real Onboarding service.",
      },
      { status: 503 },
    );
  }
}
