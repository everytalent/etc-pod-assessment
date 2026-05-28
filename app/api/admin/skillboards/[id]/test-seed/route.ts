/**
 * POST /api/admin/skillboards/[id]/test-seed
 *
 * Superadmin-only TEST helper that ENQUEUES async bank_seed jobs.
 * The cron worker (every 5 min) claims the jobs, calls
 * seedQuestionsForCell, and auto-approves the resulting proposals.
 *
 * Why async: Netlify caps Next.js serverless functions at ~30s on
 * standard plans, and the Opus seed call routinely takes 30-60s.
 * Synchronous execution would 504 every time.
 *
 * Body (all optional):
 *   { max_cells?: number, only_band?, only_level? }
 *
 * Returns 201 immediately with the count of jobs queued and an
 * estimated completion window.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  skillboardAuthoringJobs,
  skillboards,
  skills,
  tasks,
  type AuthoringJobType,
  type PerformanceLevel,
  type SeniorityBand,
} from "@/lib/db/schema";

const inputSchema = z.object({
  max_cells: z.number().int().min(1).max(5).default(1),
  only_band: z.enum(["junior", "mid", "senior"]).optional(),
  only_level: z.enum(["below", "nh", "g", "p", "tp"]).optional(),
  questions_per_cell: z.number().int().min(3).max(10).default(3),
  auto_approve: z.boolean().default(true),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { id: skillboardId } = await context.params;

  let input;
  try {
    input = inputSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [board] = await db
    .select({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
      activatedAt: skillboards.activatedAt,
    })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!board) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!board.activatedAt) {
    return NextResponse.json(
      { error: "skillboard_not_active", message: "Activate the board first." },
      { status: 422 },
    );
  }

  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, board.id));
  if (taskRows.length === 0) {
    return NextResponse.json({ error: "no_tasks_on_skillboard" }, { status: 422 });
  }

  const bands: SeniorityBand[] = input.only_band
    ? [input.only_band]
    : ["junior", "mid", "senior"];
  const levels: PerformanceLevel[] = input.only_level
    ? [input.only_level]
    : ["g"];

  const targets: {
    band: SeniorityBand;
    level: PerformanceLevel;
    taskId: string;
  }[] = [];
  for (const t of taskRows) {
    for (const b of bands) {
      for (const l of levels) {
        targets.push({ band: b, level: l, taskId: t.id });
      }
    }
  }
  const capped = targets.slice(0, input.max_cells);

  // Enqueue one bank_seed job per target. result jsonb carries the
  // seed args + auto_approve flag; the worker reads them on claim.
  await db.insert(skillboardAuthoringJobs).values(
    capped.map((t) => ({
      skillboardId: board.id,
      jobType: "bank_seed" as AuthoringJobType,
      result: {
        specialisation: board.specialisation,
        band: t.band,
        level: t.level,
        task_id: t.taskId,
        questions_per_cell: input.questions_per_cell,
        auto_approve: input.auto_approve,
      } as unknown,
    })),
  );

  return NextResponse.json(
    {
      jobs_enqueued: capped.length,
      status: "bank_seed_pending",
      message:
        "Seed jobs queued. The cron worker fires every 5 minutes; check the proposals page or retry the curl in a few minutes.",
    },
    { status: 201 },
  );
}
