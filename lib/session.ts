/**
 * Candidate session cookie — opaque httpOnly cookie carrying the response_id.
 *
 * Phase 1: cookie value is the response_id directly. UUID v4 is unguessable
 * (~122 bits of entropy) and the cookie is httpOnly so JS can't read it.
 * Tamper resistance: route handlers always validate that the response is
 * status='in_progress' before mutating, so a stolen/old cookie can't
 * resurrect a finalized session.
 *
 * Hardening for /polish: HMAC-sign the cookie with SUPABASE_JWT_SECRET so a
 * substituted UUID is rejected at the API layer.
 */

import { cookies } from "next/headers";

const COOKIE_NAME = "etc_session";
const MAX_AGE_SECONDS = 60 * 60 * 24; // 24h — generous for resume-on-refresh

export async function setCandidateSession(responseId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, responseId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getCandidateSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

export async function clearCandidateSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
