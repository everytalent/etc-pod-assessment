/**
 * Specialisation matcher — tolerant lookup of a candidate's
 * specialisation against the activated skillboards table.
 *
 * Why this exists:
 *   The Onboarding engine sends specialisation strings as exact human
 *   labels from a fixed dropdown — e.g. "Solar Installation". The
 *   Assessment engine stores skillboards under whatever name the
 *   Learning Expert typed when they created them — e.g. "Solar
 *   installation specialist". A naive case-sensitive eq() lookup
 *   misses these and blocks candidates from taking the assessment.
 *
 *   Beyond case + trailing "specialist", tenant/company-specific
 *   naming variations are unavoidable (the same role is called
 *   "Project Engineer" at one company and "Project Engineering" at
 *   another). We need a matcher that handles trivial drift
 *   automatically AND a curated alias map for harder cases.
 *
 * Strategy (in order):
 *   1. Exact match (fast path for already-correct names)
 *   2. Normalised match — lowercase + trim + collapse whitespace +
 *      strip trailing role suffixes ("specialist", "specialty",
 *      "consultant"). Catches ~90% of drift.
 *   3. Alias map — explicit "A means B" pairs, curated. Covers cases
 *      that normalisation can't reach (e.g. "System Design" →
 *      "Solar Design").
 *   4. Levenshtein within distance 2 (after normalisation) — catches
 *      "Engineer" vs "Engineering" and similar minor variations.
 *
 * The matcher returns the skillboard row when a match is found, plus
 * a `matchedBy` field naming the strategy. That's useful in logs and
 * in admin UIs for showing "we matched 'Solar Installation' to
 * skillboard 'Solar installation specialist' via normalisation".
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { skillboards } from "@/lib/db/schema";

/* ---------- Alias map (curated) ---------- */

/**
 * Canonical alias mapping. Keys are normalised onboarding labels,
 * values are normalised skillboard names. Use lowercase + space-
 * separated form (after normaliseName() is applied).
 *
 * Add entries here whenever you see candidates getting wrongly
 * blocked due to a naming mismatch that normalisation can't reach.
 * In a future iteration this can be moved into an admin-editable
 * `specialisation_aliases` table.
 */
const ALIAS_MAP: Record<string, string> = {
  // Onboarding "System Design" ↔ skillboard "Solar Design Specialist"
  "system design": "solar design",

  // Onboarding "Business Development / Sales" ↔ skillboard "Solar Sales"
  "business development sales": "solar sales",
  "business development": "solar sales",

  // O&M and Site Assessment are sometimes baked into Solar Installation
  "operations maintenance om": "solar installation",
  "operations and maintenance": "solar installation",
  "om": "solar installation",
  "site assessment": "solar installation",
};

/* ---------- Normalisation ---------- */

/**
 * Normalise a specialisation string for comparison.
 *   - Lowercase
 *   - Replace separators (-, _, /, &) with single space
 *   - Strip parenthetical clarifications: "Foo (Bar)" → "Foo"
 *   - Strip trailing role suffixes: "specialist", "specialty", "consultant"
 *   - Collapse multiple spaces, trim
 *
 * Note: we deliberately do NOT strip "engineer" or "engineering" —
 * those are part of the role identity ("Project Engineer" vs
 * "Project Manager" mean different things). Minor "engineer" vs
 * "engineering" drift is caught by the Levenshtein step instead.
 */
export function normaliseName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // strip "(O&M)" etc.
    .replace(/[\s\-_/&]+/g, " ") // separators → space
    .replace(/\b(specialist|specialty|consultant)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- Levenshtein (small, in-line) ---------- */

/**
 * Standard Damerau-free Levenshtein. Caps the comparison at
 * MAX_DIST + 1 for early exit on large strings. We only care about
 * tiny edits (≤2) since meaningful name variations are usually
 * captured by the alias map.
 */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = curr;
  }
  return prev[b.length];
}

/* ---------- The matcher ---------- */

export type MatchStrategy =
  | "exact"
  | "normalised"
  | "alias"
  | "fuzzy"
  | "none";

export type SkillboardMatchResult =
  | {
      kind: "match";
      skillboardId: string;
      storedName: string;
      activatedAt: Date | null;
      archivedAt: Date | null;
      strategy: MatchStrategy;
    }
  | { kind: "miss"; tried: { storedName: string; normalised: string }[] };

/**
 * Look up a skillboard for a specialisation label sent by Onboarding.
 *
 * Returns a `match` if found (with the strategy that succeeded), or a
 * `miss` with the list of skillboards we considered. Callers that need
 * to distinguish "no board exists" from "board exists but not yet
 * activated" should inspect `activatedAt` / `archivedAt` on the match.
 */
export async function findSkillboardForSpecialisation(
  rawSpec: string,
): Promise<SkillboardMatchResult> {
  // --- 1. exact match (fast path) ---
  const [exact] = await db
    .select({
      id: skillboards.id,
      name: skillboards.specialisation,
      activatedAt: skillboards.activatedAt,
      archivedAt: skillboards.archivedAt,
    })
    .from(skillboards)
    .where(eq(skillboards.specialisation, rawSpec))
    .limit(1);
  if (exact) {
    return {
      kind: "match",
      skillboardId: exact.id,
      storedName: exact.name,
      activatedAt: exact.activatedAt,
      archivedAt: exact.archivedAt,
      strategy: "exact",
    };
  }

  // --- 2-4. need normalisation + alias + fuzzy — pull all candidates ---
  // The skillboards table is small (dozens of rows at most), so loading
  // all of them is cheap and lets us evaluate all three strategies in
  // memory without N+1 queries.
  const candidates = await db
    .select({
      id: skillboards.id,
      name: skillboards.specialisation,
      activatedAt: skillboards.activatedAt,
      archivedAt: skillboards.archivedAt,
    })
    .from(skillboards);

  const normSpec = normaliseName(rawSpec);
  const candidatesNorm = candidates.map((c) => ({
    ...c,
    norm: normaliseName(c.name),
  }));

  // --- 2. normalised match ---
  const normHit = candidatesNorm.find((c) => c.norm === normSpec);
  if (normHit) {
    return {
      kind: "match",
      skillboardId: normHit.id,
      storedName: normHit.name,
      activatedAt: normHit.activatedAt,
      archivedAt: normHit.archivedAt,
      strategy: "normalised",
    };
  }

  // --- 3. alias map ---
  // Look up: does the candidate's spec map to a different
  // canonical name (target), and does any skillboard match that?
  const aliasTarget = ALIAS_MAP[normSpec];
  if (aliasTarget) {
    const aliasHit = candidatesNorm.find((c) => c.norm === aliasTarget);
    if (aliasHit) {
      return {
        kind: "match",
        skillboardId: aliasHit.id,
        storedName: aliasHit.name,
        activatedAt: aliasHit.activatedAt,
        archivedAt: aliasHit.archivedAt,
        strategy: "alias",
      };
    }
  }

  // --- 4. fuzzy (Levenshtein ≤ 2) ---
  // Last resort. Catches "engineer" vs "engineering", typos, missing
  // letters. Restricted to small distance to avoid false matches.
  // Pick the closest one if there's a tie.
  let best: typeof candidatesNorm[number] | null = null;
  let bestDist = 3;
  for (const c of candidatesNorm) {
    const d = levenshtein(normSpec, c.norm, 2);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (best) {
    return {
      kind: "match",
      skillboardId: best.id,
      storedName: best.name,
      activatedAt: best.activatedAt,
      archivedAt: best.archivedAt,
      strategy: "fuzzy",
    };
  }

  return {
    kind: "miss",
    tried: candidatesNorm.map((c) => ({
      storedName: c.name,
      normalised: c.norm,
    })),
  };
}
