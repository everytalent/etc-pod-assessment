/**
 * cadre-deriver — map a (band, level) tuple to a learner-facing cadre.
 *
 * The Validation Engine produces two labels for the same underlying
 * performance evidence (see memory/cadre-vs-band.md):
 *   - (band, level) is what recruiters and companies see.
 *   - cadre is what the learner sees about their own progression.
 *
 * Pure function — no DB, no IO. Adjusting the mapping is a code change
 * in this file only; everywhere else reads `derivedCadre(band, level)`.
 *
 * Tuning principle: cadres compress the 15-cell grid into 5 progression
 * tiers that make sense as a single-axis ladder for the learner. We
 * map by total seniority so a "Junior at Pro" and a "Mid at Growing"
 * read as similar progression points to the learner, even though the
 * recruiter labels them differently.
 */

import type {
  Cadre,
  PerformanceLevel,
  SeniorityBand,
} from "./types";

const BAND_ORDINAL: Record<SeniorityBand, number> = {
  junior: 0,
  mid: 1,
  senior: 2,
};

const LEVEL_ORDINAL: Record<PerformanceLevel, number> = {
  below: 0,
  nh: 1,
  g: 2,
  p: 3,
  tp: 4,
};

/**
 * Combined ordinal in [0, 14] — band weighted x5 so a Senior at Below
 * still outranks a Junior at Top Performer (10 vs 4). This matches
 * how recruiter-facing language treats band as the primary axis.
 */
function combinedOrdinal(
  band: SeniorityBand,
  level: PerformanceLevel,
): number {
  return BAND_ORDINAL[band] * 5 + LEVEL_ORDINAL[level];
}

/**
 * Cadre buckets across the 15-point combined ordinal.
 *
 *   EL   (0–2)  — Junior Below/NH/Growing
 *   INT  (3–5)  — Junior Pro/TP, Mid Below
 *   EXPD (6–8)  — Mid NH/Growing/Pro
 *   ADV  (9–11) — Mid TP, Senior Below/NH
 *   EXPT (12–14)— Senior Growing/Pro/TP
 *
 * Why these cutoffs: keeps three cells per cadre, treats "Mid TP" and
 * "Senior NH" as roughly equivalent progression points (Advanced),
 * preserves "Expert" for clearly senior performers.
 */
export function deriveCadre(
  band: SeniorityBand,
  level: PerformanceLevel,
): Cadre {
  const ord = combinedOrdinal(band, level);
  if (ord <= 2) return "el";
  if (ord <= 5) return "int";
  if (ord <= 8) return "expd";
  if (ord <= 11) return "adv";
  return "expt";
}

/**
 * Inverse helper for question-bank picks: when we want a question
 * targeting an "Advanced" learner, which (band, level) cells qualify?
 * Used by the CAT engine when surfacing learner-facing progression
 * hints in the candidate UI (e.g. "you're approaching Expert").
 */
export function cellsForCadre(
  cadre: Cadre,
): readonly { band: SeniorityBand; level: PerformanceLevel }[] {
  const cells: { band: SeniorityBand; level: PerformanceLevel }[] = [];
  for (const band of ["junior", "mid", "senior"] as const) {
    for (const level of ["below", "nh", "g", "p", "tp"] as const) {
      if (deriveCadre(band, level) === cadre) {
        cells.push({ band, level });
      }
    }
  }
  return cells;
}
