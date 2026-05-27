/**
 * POST /api/admin/jobs/opus-seed
 *
 * Triggers Opus question seeding for an activated skillboard.
 *
 * Body: { skillboard_id, only_band?, only_level? }
 *
 * For every (band × level × task) cell on the board, queues a seed call
 * that proposes ~5 questions. The proposals land in
 * `question_bank_proposals` for editor approval before publishing.
 *
 * Cost: ~5 questions × ~$0.10 per call = $0.50 per cell. A full board
 * (29 tasks × 15 cells = 435 cells) = ~$220 if seeded blanket. The
 * `only_band` / `only_level` filters let you scope it down — start
 * with one (band, level) cell to validate quality before going wider.
 *
 * Permission: superadmin (this spends real money fast).
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  skillboards,
  skills,
  tasks,
  type PerformanceLevel,
  type SeniorityBand,
} from "@/lib/db/schema";
import { seedQuestionsForCell } from "@/lib/engines/assessment/proposals/opus-seed";

const inputSchema = z.object({
  skillboard_id: z.string().uuid(),
  only_band: z.enum(["junior", "mid", "senior"]).optional(),
  only_level: z.enum(["below", "nh", "g", "p", "tp"]).optional(),
  /** Hard cap on cells processed this run, so a typo doesn't burn $200. */
  max_cells: z.number().int().min(1).max(50).default(5),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Skillboard must be activated.
  const [board] = await db
    .select({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
      activatedAt: skillboards.activatedAt,
    })
    .from(skillboards)
    .where(eq(skillboards.id, input.skillboard_id))
    .limit(1);

  if (!board) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!board.activatedAt) {
    return NextResponse.json(
      {
        error: "skillboard_not_active",
        message: "Activate the skillboard before seeding questions.",
      },
      { status: 422 },
    );
  }

  // Resolve tasks under this skillboard.
  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, input.skillboard_id));

  if (taskRows.length === 0) {
    return NextResponse.json(
      { error: "no_tasks_on_skillboard" },
      { status: 422 },
    );
  }

  // Build the (band, level, task) targets list.
  const bands: SeniorityBand[] = input.only_band ? [input.only_band] : ["junior", "mid", "senior"];
  const levels: PerformanceLevel[] = input.only_level ? [input.only_level] : ["below", "nh", "g", "p", "tp"];
  const targets: { band: SeniorityBand; level: PerformanceLevel; taskId: string }[] = [];
  for (const t of taskRows) {
    for (const b of bands) {
      for (const l of levels) {
        targets.push({ band: b, level: l, taskId: t.id });
      }
    }
  }

  // Cap to max_cells.
  const capped = targets.slice(0, input.max_cells);

  // Run seeds sequentially so one rate-limit error doesn't kill the rest.
  // (We could parallelise with Promise.allSettled later; serial is safer.)
  let totalEnqueued = 0;
  const failures: { taskId: string; band: string; level: string; error: string }[] = [];
  for (const target of capped) {
    try {
      const result = await seedQuestionsForCell({
        specialisation: board.specialisation,
        band: target.band,
        level: target.level,
        taskId: target.taskId,
      });
      totalEnqueued += result.enqueued;
    } catch (err) {
      failures.push({
        taskId: target.taskId,
        band: target.band,
        level: target.level,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  void and; // keep import used
  return NextResponse.json({
    cells_processed: capped.length,
    cells_skipped: targets.length - capped.length,
    questions_enqueued: totalEnqueued,
    failures,
  });
}
