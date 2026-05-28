/**
 * Service-token Bearer auth for cross-engine HTTP contracts.
 *
 * Accepts either:
 *   - `ETC_ASSESSMENT_SERVICE_TOKEN` (the canonical name in the
 *     2026-05-28 contract — single string), OR
 *   - any token listed in `ETC_PROFILE_SERVICE_TOKENS` (legacy comma-
 *     separated list from the v1.1 contract, retained for backward
 *     compat so the existing /api/internal/candidates/[id]/profile
 *     endpoint keeps working without env-var churn).
 *
 * If neither env var is set we deny everything — fail-closed.
 */

export function isValidServiceToken(token: string): boolean {
  if (!token) return false;
  const single = (process.env.ETC_ASSESSMENT_SERVICE_TOKEN ?? "").trim();
  if (single && token === single) return true;
  const legacyList = (process.env.ETC_PROFILE_SERVICE_TOKENS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return legacyList.includes(token);
}

export function extractBearer(req: Request): string {
  return (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
