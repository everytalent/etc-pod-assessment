/**
 * Talent Validation Engine — shared internal types.
 *
 * Re-exports the DB enum unions under shorter aliases so engine code reads
 * naturally without depending on Drizzle types throughout. Keep this list
 * tight: anything that touches engine boundaries (CAT, synthesis,
 * scoring, skillboard authoring) imports from here, not from
 * `lib/db/schema.ts` directly.
 */

import type {
  ApprovalState,
  AssessmentMode,
  Cadre,
  HireRecommendation,
  PerformanceLevel,
  SeniorityBand,
  SkillboardCreationPath,
  TranslationStatus,
  ValidationStatus,
} from "@/lib/db/schema";

export type {
  ApprovalState,
  AssessmentMode,
  Cadre,
  HireRecommendation,
  PerformanceLevel,
  SeniorityBand,
  SkillboardCreationPath,
  TranslationStatus,
  ValidationStatus,
};

/**
 * The 15-cell grid of (band × level) on every task. Listed here in
 * canonical order so admin UIs and Opus-generation prompts render the
 * same table without each having to encode the order.
 */
export const BAND_ORDER: readonly SeniorityBand[] = [
  "junior",
  "mid",
  "senior",
] as const;

export const LEVEL_ORDER: readonly PerformanceLevel[] = [
  "below",
  "nh",
  "g",
  "p",
  "tp",
] as const;

/** Human display labels for bands (used in CV cards, drill-in chips). */
export const BAND_LABELS: Record<SeniorityBand, string> = {
  junior: "Junior",
  mid: "Mid-Level",
  senior: "Senior",
};

/** Human display labels for performance levels. */
export const LEVEL_LABELS: Record<PerformanceLevel, string> = {
  below: "Below Standard",
  nh: "New Hire",
  g: "Growing",
  p: "Pro",
  tp: "Top Performer",
};

/** Human display labels for learner-facing cadres. */
export const CADRE_LABELS: Record<Cadre, string> = {
  el: "Entry-Level",
  int: "Intermediate",
  expd: "Expanded",
  adv: "Advanced",
  expt: "Expert",
};

/**
 * Profile shape read from the Onboarding engine via
 * GET /api/internal/candidates/[id]/profile. This is the engine's
 * canonical view of an onboarded candidate — keep it minimal so the
 * Onboarding interface stays cheap to fulfil.
 */
export type OnboardingProfile = {
  candidate_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  country: string;
  city: string;
  state: string | null;
  /** Onboarding's `specialisation` string, e.g. "Solar Installation". */
  specialisation: string;
  /**
   * `true` if candidate answered Yes to "have you worked in the solar
   * industry?", `false` otherwise. Drives the band-deducer.
   */
  has_solar_experience: boolean;
  /**
   * Bucketed years from the onboarding dropdown.
   *
   * v1.1 (2026-05-26): narrowed from 5 buckets to 4. Onboarding's
   * actual dropdown has always been 4 buckets (Less than 3 · 3-5 ·
   * 5-10 · 10+) — the v1 schema's 5-bucket version was an over-
   * specification that didn't match reality. Producer side now
   * returns ONLY these values.
   *
   * See: podsproject/docs/2026-05-26-validation-engine-contract-v1.1.md
   */
  years_bucket:
    | "less_than_3"
    | "3_to_5"
    | "5_to_10"
    | "10_plus"
    | null;
  /** Onboarding's industry when has_solar_experience = false. */
  non_solar_industry?: string | null;
  /** Multi-select work types or roles from onboarding step 2. */
  work_types: string[];
  /** Selected skills from onboarding step 3. */
  skills: string[];
  /** Certifications listed in onboarding step 4 (raw text). */
  certifications: string[];
  /** Portfolio projects (project work in onboarding step 5). */
  portfolio: PortfolioProjectSummary[];
};

export type PortfolioProjectSummary = {
  /** Project name, company, or site label. */
  name: string;
  /** Free-text role. */
  role: string | null;
  /** Project type or system size if technical specialisations. */
  scope: string | null;
  /**
   * Captured Years Completed range or From/To years — a single label
   * the band-deducer can scan for "leadership"/"oversight" indicators.
   */
  period: string | null;
  /** Multi-select activities reported on this project. */
  activities: string[];
};

/**
 * Output of the band-deducer. `confidence` is in [0, 1]; below 0.5
 * means we'd want a reviewer to confirm before the CAT engine relies
 * on the claim.
 */
export type DeducedBand = {
  band: SeniorityBand;
  confidence: number;
  reasoning: string;
};
