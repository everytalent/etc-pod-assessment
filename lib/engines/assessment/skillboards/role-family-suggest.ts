/**
 * Smart default for role_family on the create-skillboard form.
 *
 * Keyword-driven, deterministic, fast (~µs). The form preselects a
 * radio based on the specialisation name + brief; admin can override.
 *
 * Goals:
 *   - Right 80% of the time on ETC's current spec set (Solar Installation,
 *     SHS, Mini-grid, Battery Storage, Solar Sales Specialist, etc.)
 *   - Never silent-wrong: if no signals fire either way, return null
 *     and let the UI force the admin to pick.
 *
 * Tune by editing the keyword lists below. Add `__test__` exports if
 * we want vitest coverage of edge cases later.
 */

import type { SkillboardRoleFamily } from "@/lib/db/schema";

const TECHNICAL_KEYWORDS = [
  "install",
  "wire",
  "wiring",
  "connect",
  "test",
  "diagnose",
  "diagnos",
  "commission",
  "maintain",
  "maintenance",
  "o&m",
  "repair",
  "specialist",
  "technician",
  "engineer",
  "design",
  "sizing",
  "spec",
  "battery",
  "inverter",
  "panel",
  "racking",
  "earthing",
  "grounding",
  "field",
];

const BD_PM_KEYWORDS = [
  "sales",
  " bd ",
  "business development",
  "outreach",
  "negotiate",
  "negotiating",
  "close",
  "closing",
  "pipeline",
  "lead generation",
  "customer",
  "client",
  "account",
  "territory",
  "quota",
  "pricing",
  "proposal",
  "ppa",
  "tariff",
  "partnership",
];

const HYBRID_KEYWORDS = [
  "manage",
  "manager",
  "lead",
  "leadership",
  "coordinator",
  "coordination",
  "project manager",
  "project management",
  "deliver",
  "delivery",
  "owner",
  "principal",
  "head of",
  "director",
];

export type RoleFamilySuggestion = {
  suggested: SkillboardRoleFamily | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export function suggestRoleFamily(args: {
  specialisation: string;
  brief?: string;
}): RoleFamilySuggestion {
  const haystack = `${args.specialisation} ${args.brief ?? ""}`.toLowerCase();

  const techHits = TECHNICAL_KEYWORDS.filter((k) => haystack.includes(k));
  const bdHits = BD_PM_KEYWORDS.filter((k) => haystack.includes(k));
  const hybridHits = HYBRID_KEYWORDS.filter((k) => haystack.includes(k));

  // Special case: when hybrid signals fire AND either tech or bd also
  // fire, it's almost always a true hybrid (Solar Project Manager,
  // Mini-grid Lead, etc.).
  if (hybridHits.length > 0 && (techHits.length > 0 || bdHits.length > 0)) {
    return {
      suggested: "hybrid",
      confidence: "high",
      reason: `Detected leadership/coordination wording (${hybridHits.slice(0, 3).join(", ")}) alongside ${techHits.length > 0 ? "technical" : "commercial"} content — typically a hybrid role.`,
    };
  }

  // Strict counts.
  const dominantTech = techHits.length >= 2 && bdHits.length === 0;
  const dominantBd = bdHits.length >= 2 && techHits.length === 0;

  if (dominantTech) {
    return {
      suggested: "technical",
      confidence: "high",
      reason: `Technical wording dominates (${techHits.slice(0, 3).join(", ")}).`,
    };
  }
  if (dominantBd) {
    return {
      suggested: "bd_pm",
      confidence: "high",
      reason: `Commercial wording dominates (${bdHits.slice(0, 3).join(", ")}).`,
    };
  }

  // Single-hit weak signals — medium confidence.
  if (techHits.length === 1 && bdHits.length === 0) {
    return {
      suggested: "technical",
      confidence: "medium",
      reason: `Single technical signal (${techHits[0]}). Confirm before proceeding.`,
    };
  }
  if (bdHits.length === 1 && techHits.length === 0) {
    return {
      suggested: "bd_pm",
      confidence: "medium",
      reason: `Single commercial signal (${bdHits[0]}). Confirm before proceeding.`,
    };
  }

  // Conflicting tech + bd signals → hybrid suggestion at medium confidence.
  if (techHits.length > 0 && bdHits.length > 0) {
    return {
      suggested: "hybrid",
      confidence: "medium",
      reason: `Mixed technical (${techHits[0]}) and commercial (${bdHits[0]}) wording — likely hybrid.`,
    };
  }

  // No useful signals.
  return {
    suggested: null,
    confidence: "low",
    reason:
      "No strong signals in the specialisation name or brief. Pick the family that best matches the role's day-to-day work.",
  };
}
