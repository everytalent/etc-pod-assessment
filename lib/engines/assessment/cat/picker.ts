/**
 * Question picker — given a `(specialisation, band, level)` target from
 * the CAT state machine, pick the next question from the question bank.
 *
 * Rules:
 *   - A question belongs to the skillboard its anchor task sits under
 *     (question → task → skill → skillboard), NOT to whatever the
 *     free-text questions.specialisation column says. That column is
 *     duplicated data and drifts away from the board it describes.
 *   - Only ACTIVATED skillboards contribute questions (via skillboards.activatedAt).
 *   - Only questions already answered in this response are excluded
 *     (no repeats per session).
 *   - Within the target cell, pick by difficulty_score closest to the
 *     candidate's running estimate. If the cell is empty, widen ±1 level
 *     once before failing.
 *   - Returns null if no question is available even after widening —
 *     caller decides whether to advance state or end the spec.
 */

import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { findSkillboardForSpecialisation } from "@/lib/engines/assessment/specialisation-matcher";
import {
  questions,
  skillboards,
  skills,
  tasks,
  type PerformanceLevel,
  type Question,
  type SeniorityBand,
} from "@/lib/db/schema";

const LEVEL_NEIGHBOURS: Record<PerformanceLevel, PerformanceLevel[]> = {
  below: ["nh"],
  nh: ["below", "g"],
  g: ["nh", "p"],
  p: ["g", "tp"],
  tp: ["p"],
};

/**
 * Bands the picker is willing to fall back to when the exact band has no
 * question for the target level. Ordered by closeness — junior falls
 * back to mid before senior, etc. The first hit wins.
 *
 * This was added 2026-06-18 to prevent candidates from getting an
 * instant "Submitted" screen when the bank has questions but none
 * for their exact band — common during early ramp-up while you're
 * still seeding the bank from one or two bands.
 */
const BAND_FALLBACK: Record<SeniorityBand, SeniorityBand[]> = {
  junior: ["mid", "senior"],
  mid: ["senior", "junior"],
  senior: ["mid", "junior"],
};

export async function pickNextValidationQuestion(args: {
  specialisation: string;
  band: SeniorityBand;
  level: PerformanceLevel;
  excludeQuestionIds: string[];
  targetDifficulty?: number; // 1-10; lower = easier
}): Promise<Question | null> {
  // Resolve the specialisation to a skillboard ONCE, using the same
  // matcher POST /api/internal/sessions used to mint this session. That
  // shared resolution is the point: the invite gate checks "does this
  // board's bank have questions" while the picker checks "which
  // questions belong to this board" — if the two disagree, a candidate
  // gets an invite for a bank that then serves them nothing.
  //
  // Once resolved, membership comes from the question's anchor chain
  // (question → task → skill → skillboard), never from the free-text
  // questions.specialisation column. That column is duplicated data and
  // it drifts: the Solar Installation board carries questions tagged
  // both "Solar Installation" and "Solar installation specialist", and
  // the System Design board carries questions tagged "Solar Design
  // Specialist". Text matching dead-ended real candidates on that drift
  // (System Design served zero questions on 2026-08-26 for exactly this
  // reason). Foreign keys don't drift.
  const match = await findSkillboardForSpecialisation(args.specialisation);
  const skillboardId =
    match.kind === "match" && !match.archivedAt ? match.skillboardId : null;

  // Try targets in order:
  //   1. exact (band, level)
  //   2. exact band, neighbour levels
  //   3. fallback bands, exact level
  //   4. fallback bands, neighbour levels
  // First hit wins. Only returns null when the bank has NO usable
  // question across all combinations — at which point the CAT engine
  // genuinely should end.
  const bands: SeniorityBand[] = [args.band, ...BAND_FALLBACK[args.band]];
  const levelsAtBand = (b: SeniorityBand) =>
    b === args.band
      ? [args.level, ...LEVEL_NEIGHBOURS[args.level]]
      : [args.level, ...LEVEL_NEIGHBOURS[args.level]];

  for (const b of bands) {
    for (const l of levelsAtBand(b)) {
      const row = await pickFromCell(
        args.specialisation,
        b,
        l,
        args.excludeQuestionIds,
        args.targetDifficulty,
        skillboardId,
      );
      if (row) return row;
    }
  }
  return null;
}

async function pickFromCell(
  specialisation: string,
  band: SeniorityBand,
  level: PerformanceLevel,
  excludeIds: string[],
  targetDifficulty?: number,
  skillboardId?: string | null,
): Promise<Question | null> {
  // ORDER BY ABS(difficulty_score - target) when given a target, otherwise random.
  // RANDOM() avoids the same candidate seeing the same question first
  // when multiple match.
  const targetExpr =
    targetDifficulty !== undefined
      ? sql`ABS(COALESCE(${questions.difficultyScore}, 5) - ${targetDifficulty})`
      : sql`RANDOM()`;

  const conditions = [eq(questions.band, band), eq(questions.level, level)];

  if (skillboardId) {
    // Preferred path: board membership comes from the anchor chain, so
    // a question belongs to the board its task actually sits under —
    // regardless of what the free-text specialisation column claims.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${tasks} t
      JOIN ${skills} sk ON sk.id = t.skill_id
      JOIN ${skillboards} sb ON sb.id = sk.skillboard_id
      WHERE t.id = ${questions.taskId}
        AND sb.id = ${skillboardId}
        AND sb.activated_at IS NOT NULL
    )`);
  } else {
    // Fallback for specialisations with no resolvable skillboard (legacy
    // rows predating the skillboard model, whose questions have no task
    // anchor at all). Keeps the old bidirectional-prefix text match so
    // nothing that works today regresses.
    conditions.push(sql`(
      LOWER(${questions.specialisation}) LIKE LOWER(${specialisation}) || '%'
      OR LOWER(${specialisation}) LIKE LOWER(${questions.specialisation}) || '%'
    )`);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${tasks} t
      JOIN ${skills} sk ON sk.id = t.skill_id
      JOIN ${skillboards} sb ON sb.id = sk.skillboard_id
      WHERE t.id = ${questions.taskId} AND sb.activated_at IS NOT NULL
    )`);
  }
  if (excludeIds.length > 0) {
    // Use Drizzle's notInArray helper so postgres-js binds each UUID as
    // a separate parameter. The earlier `ne(questions.id, '__none__')`
    // safety line threw `invalid input syntax for type uuid` because
    // it asked Postgres to compare a uuid column to the literal string
    // '__none__'.
    conditions.push(notInArray(questions.id, excludeIds));
  }

  const rows = await db
    .select()
    .from(questions)
    .where(and(...conditions))
    .orderBy(targetExpr)
    .limit(1);
  return rows[0] ?? null;
}

/** Build a per-spec plan entry for `responses.metadata.adaptive_plan`. */
export function buildPlanEntry(args: {
  specialisation: string;
  role: "primary" | "secondary";
  budget: number;
}): {
  specialisation: string;
  role: "primary" | "secondary";
  budget: number;
  state: "calibrating";
  band_locked: null;
  level_running: null;
  question_ids: never[];
  transitions: never[];
} {
  return {
    specialisation: args.specialisation,
    role: args.role,
    budget: args.budget,
    state: "calibrating",
    band_locked: null,
    level_running: null,
    question_ids: [],
    transitions: [],
  };
}

/* ---------- Per-spec budget table (PRD §4) ---------- */

/**
 * Questions per specialisation, sized so the WHOLE sitting lands in the
 * 15-18 range rather than each spec getting a full-length assessment.
 *
 * The old table budgeted per spec without regard to the total: four
 * specialisations meant 30 questions, and in practice sessions ran past
 * 40 because the budget was not being enforced at all. A candidate is
 * sitting one assessment, not four, and the time they will give it does
 * not scale with how many specialisations they happen to list.
 *
 * Totals: 17 for one spec, 9+8 for two, 7+5+5 for three, 5+4+4+4 for
 * four. Every row lands at 17, inside the 18 hard cap.
 */
export const PER_SPEC_BUDGET: Record<
  number,
  { primary: number; secondary: number; cap: number }
> = {
  1: { primary: 17, secondary: 0, cap: 17 },
  2: { primary: 9, secondary: 8, cap: 17 },
  3: { primary: 7, secondary: 5, cap: 17 },
  4: { primary: 5, secondary: 4, cap: 17 },
};

/** Absolute ceiling across every spec in one sitting. */
export const HARD_QUESTION_CAP = 18;
