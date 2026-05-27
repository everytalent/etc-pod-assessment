/**
 * GET /api/profiles/[candidate_id]
 *
 * Public Vetted Talent Profile contract — consumed by Matching, POD,
 * Training, and any future cross-engine reader. Per [[etc-engine-taxonomy]],
 * this is the ONLY way other engines should read a candidate's profile.
 *
 * Auth: service-token via Authorization: Bearer <token>. The valid
 * tokens are env-driven (`ETC_PROFILE_SERVICE_TOKENS` — comma-separated
 * list so we can rotate per consumer). No user cookies.
 *
 * Rate-limit: enforced by upstream (Netlify edge config / a future
 * middleware); not implemented in this handler.
 *
 * 404 if no profile exists for the candidate yet.
 */

import { NextResponse } from "next/server";

import { getPublicProfileByCandidate } from "@/lib/engines/assessment/profile/repository";

export async function GET(
  req: Request,
  context: { params: Promise<{ candidate_id: string }> },
): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!isValidServiceToken(token)) {
    return NextResponse.json(
      { error: "unauthorised", message: "Service token required." },
      { status: 401 },
    );
  }

  const { candidate_id } = await context.params;
  const profile = await getPublicProfileByCandidate(candidate_id);
  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(profile);
}

function isValidServiceToken(token: string): boolean {
  if (!token) return false;
  const tokens = (process.env.ETC_PROFILE_SERVICE_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.includes(token);
}
