/**
 * band-deducer — map an Onboarding profile to a claimed seniority band.
 *
 * The Validation Engine PRD requires `claimed_seniority_band` as input
 * (Junior/Mid/Senior). The Elite Onboarding flow doesn't collect this
 * directly — instead it captures years-of-experience (bucketed) and
 * multi-select work-type/responsibility checkboxes.
 *
 * This module produces a band from those existing fields, plus a
 * confidence + reasoning string, so the engine can surface the
 * deduction in the admin UI and the candidate can correct it before
 * starting the assessment if they disagree.
 *
 * Pure function — no DB, no IO. Easy to unit test, easy to tune from
 * the dashboard. Tuning happens in this file; deployments rev the
 * weights here, not the schema.
 */

import type { DeducedBand, OnboardingProfile, SeniorityBand } from "./types";

/* ---------- Tunable inputs ---------- */

/**
 * Years buckets that map cleanly to a single band, all else equal.
 *
 * Bucket scheme: v1.1 of the contract (2026-05-26). Four buckets,
 * matching the onboarding step-2 dropdown.
 *   less_than_3 → Junior (entry-level; broadest junior bucket)
 *   3_to_5      → Mid    (intermediate; the v1.1 amendment intentionally
 *                          shifts this above v1's "2_to_5" so we treat
 *                          3+ years as mid by default)
 *   5_to_10     → Senior
 *   10_plus     → Senior
 *
 * Role signals (leadership/coordination wording) can still bump a
 * candidate up or floor them down, see the SENIOR_SIGNALS / JUNIOR_SIGNALS
 * lists below.
 */
const BAND_FROM_YEARS: Record<
  NonNullable<OnboardingProfile["years_bucket"]>,
  SeniorityBand
> = {
  less_than_3: "junior",
  "3_to_5": "mid",
  "5_to_10": "senior",
  "10_plus": "senior",
};

/**
 * Substrings inside work_types / portfolio.role / portfolio.activities
 * that bump the deduction one band up. Order-sensitive: the first
 * match wins so we can tier-shift more aggressively on stronger signals.
 *
 * Keep lowercased — comparison is case-insensitive.
 */
const SENIOR_SIGNALS: readonly string[] = [
  "lead",
  "principal",
  "head of",
  "director",
  "manager",
  "managing",
  "owner",
  "founder",
  "ceo",
  "cto",
  "vp ",
  "project oversight",
  "team coordination",
  "team leadership",
  "supervis",
  "epc",
  "contractor management",
  "stakeholder reporting",
];

/**
 * Substrings that bump down to junior even when years say otherwise —
 * e.g. someone with 5+ years but only entry-level tasks under their
 * belt would be Mid at best.
 */
const JUNIOR_SIGNALS: readonly string[] = [
  "intern",
  "trainee",
  "apprentice",
  "assistant",
  "support",
];

/* ---------- Public API ---------- */

export function deduceBand(profile: OnboardingProfile): DeducedBand {
  // Single text blob to scan against the signal lists. Includes role
  // labels AND activity labels from each portfolio project, because
  // onboarding doesn't have a single "job title" field — the evidence
  // is spread across these fields.
  const textPool = buildTextPool(profile);

  const seniorHits = SENIOR_SIGNALS.filter((s) => textPool.includes(s));
  const juniorHits = JUNIOR_SIGNALS.filter((s) => textPool.includes(s));

  const baseline: SeniorityBand = profile.years_bucket
    ? BAND_FROM_YEARS[profile.years_bucket]
    : "junior";

  let band: SeniorityBand = baseline;
  const reasons: string[] = [];

  if (profile.years_bucket) {
    reasons.push(
      `Years bucket = ${profile.years_bucket} → baseline ${BAND_LABEL[baseline]}`,
    );
  } else {
    reasons.push("No years bucket on file → baseline Junior");
  }

  // Junior signals strictly dominate — entry-level role wording floors
  // the band even when years suggest otherwise.
  if (juniorHits.length > 0 && baseline !== "junior") {
    band = "junior";
    reasons.push(
      `Junior-tier role wording detected (${juniorHits.join(", ")}) → floored to Junior`,
    );
  } else if (seniorHits.length > 0) {
    // Promote one band up, capped at senior. Two or more senior signals
    // promotes to senior even from junior baseline (someone described
    // as "lead" and "manager" with 1-2 years is unusual but possible
    // in a smaller org).
    const promoted = promoteOneBand(band);
    if (promoted !== band) {
      band = seniorHits.length >= 2 ? "senior" : promoted;
      reasons.push(
        `Leadership signals detected (${seniorHits.join(", ")}) → promoted to ${BAND_LABEL[band]}`,
      );
    }
  }

  // v1.1: 3-5 with no leadership signals stays Mid. (Old v1 logic
  // demoted 2-5 → junior because 2-3 year contributors are usually
  // not Mid. The v1.1 bucket starts at 3 years, which is more clearly
  // intermediate, so we keep the Mid baseline.)

  // Non-solar candidates only ever start at Junior or Mid (and the
  // onboarding flow already redirects 10y+ non-solar people to the
  // Transition programme). Cap to mid here as a safety belt.
  if (!profile.has_solar_experience && band === "senior") {
    band = "mid";
    reasons.push(
      "Non-solar background → capped at Mid (Senior requires solar experience)",
    );
  }

  const confidence = computeConfidence(profile, seniorHits, juniorHits);

  return {
    band,
    confidence,
    reasoning: reasons.join(". ") + ".",
  };
}

/* ---------- Helpers ---------- */

const BAND_LABEL: Record<SeniorityBand, string> = {
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
};

function buildTextPool(profile: OnboardingProfile): string {
  const portfolioText = profile.portfolio.flatMap((p) => [
    p.role ?? "",
    p.scope ?? "",
    p.period ?? "",
    ...p.activities,
  ]);
  return [
    ...profile.work_types,
    ...portfolioText,
    profile.specialisation,
    profile.non_solar_industry ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function promoteOneBand(band: SeniorityBand): SeniorityBand {
  if (band === "junior") return "mid";
  if (band === "mid") return "senior";
  return "senior";
}

function computeConfidence(
  profile: OnboardingProfile,
  seniorHits: readonly string[],
  juniorHits: readonly string[],
): number {
  let score = 0.5;

  // v1.1 buckets — confidence boost calibrated to bucket specificity:
  //   10_plus    : highly specific (clearly senior) → +0.20
  //   5_to_10    : specific enough to read as senior → +0.15
  //   3_to_5    : intermediate, ambiguous on Mid-vs-Senior edges → +0.10
  //   less_than_3 : broad (covers 0-3 years), Junior is safe but not certain → +0.10
  if (profile.years_bucket === "10_plus") {
    score += 0.2;
  } else if (profile.years_bucket === "5_to_10") {
    score += 0.15;
  } else if (profile.years_bucket === "3_to_5") {
    score += 0.1;
  } else if (profile.years_bucket === "less_than_3") {
    score += 0.1;
  }

  // Each role-signal hit (in either direction) tightens confidence,
  // capped so a candidate with five "lead" mentions doesn't get
  // unfairly perfect confidence.
  score += Math.min(0.2, seniorHits.length * 0.07);
  score += Math.min(0.15, juniorHits.length * 0.07);

  // Conflicting signals (both senior AND junior wording) drop confidence.
  if (seniorHits.length > 0 && juniorHits.length > 0) {
    score -= 0.15;
  }

  // Empty profiles (no portfolio, no work_types) drop confidence.
  if (profile.portfolio.length === 0 && profile.work_types.length === 0) {
    score -= 0.2;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}
