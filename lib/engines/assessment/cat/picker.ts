/**
 * Question picker — given a `(specialisation, band, level)` target from
 * the CAT state machine, pick the next question from the question bank.
 *
 * Rules:
 *   - Only ACTIVATED skillboards contribute questions (via skillboards.activatedAt).
 *   - Only questions already answered in this response are excluded
 *     (no repeats per session).
 *   - Within the target cell, pick by difficulty_score closest to the
 *     candidate's running estimate. If the cell is empty, widen ±1 level
 *     once before failing.
 *   - Returns null if no question is available even after widening —
 *     caller decides whether to advance state or end the spec.
 */

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
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

export async function pickNextValidationQuestion(args: {
  specialisation: string;
  band: SeniorityBand;
  level: PerformanceLevel;
  excludeQuestionIds: string[];
  targetDifficulty?: number; // 1-10; lower = easier
}): Promise<Question | null> {
  const targets: { band: SeniorityBand; level: PerformanceLevel }[] = [
    { band: args.band, level: args.level },
    ...LEVEL_NEIGHBOURS[args.level].map((l) => ({ band: args.band, level: l })),
  ];

  for (const target of targets) {
    const row = await pickFromCell(args.specialisation, target.band, target.level, args.excludeQuestionIds, args.targetDifficulty);
    if (row) return row;
  }
  return null;
}

async function pickFromCell(
  specialisation: string,
  band: SeniorityBand,
  level: PerformanceLevel,
  excludeIds: string[],
  targetDifficulty?: number,
): Promise<Question | null> {
  // ORDER BY ABS(difficulty_score - target) when given a target, otherwise random.
  // RANDOM() avoids the same candidate seeing the same question first
  // when multiple match.
  const targetExpr =
    targetDifficulty !== undefined
      ? sql`ABS(COALESCE(${questions.difficultyScore}, 5) - ${targetDifficulty})`
      : sql`RANDOM()`;

  const conditions = [
    eq(questions.specialisation, specialisation),
    eq(questions.band, band),
    eq(questions.level, level),
    // Only questions whose anchor task belongs to an active skillboard.
    sql`EXISTS (
      SELECT 1 FROM ${tasks} t
      JOIN ${skills} sk ON sk.id = t.skill_id
      JOIN ${skillboards} sb ON sb.id = sk.skillboard_id
      WHERE t.id = ${questions.taskId} AND sb.activated_at IS NOT NULL
    )`,
  ];
  if (excludeIds.length > 0) {
    conditions.push(ne(questions.id, sql.raw("'__none__'"))); // safety
    conditions.push(sql`${questions.id} NOT IN ${excludeIds}`);
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

export const PER_SPEC_BUDGET: Record<
  number,
  { primary: number; secondary: number; cap: number }
> = {
  1: { primary: 13, secondary: 0, cap: 15 },
  2: { primary: 11, secondary: 9, cap: 22 },
  3: { primary: 10, secondary: 7, cap: 27 },
  4: { primary: 9, secondary: 6, cap: 30 },
};
export const HARD_QUESTION_CAP = 30;
