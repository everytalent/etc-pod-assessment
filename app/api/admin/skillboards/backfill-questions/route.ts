/**
 * POST /api/admin/skillboards/backfill-questions
 *
 * Sweeps every active skillboard, counts existing questions per
 * (band × level × task) cell on the linked validation bank, and
 * enqueues `bank_seed` authoring jobs for cells with fewer than the
 * target count. Idempotent: cells already at or above target get
 * skipped, in-flight (pending / running) jobs for the same cell get
 * skipped so we don't queue duplicates.
 *
 * This is the human-triggered backfill for skillboards activated
 * before the auto-seed-on-activate feature landed, or where the
 * worker missed a job. Runs synchronously to enqueue but does NOT
 * wait for generation — the existing worker picks the jobs up on
 * its next poll and auto-approves output into the validation bank.
 *
 * Query params:
 *   ?dry_run=1    — count and return the plan without inserting jobs
 *   ?target=N     — questions per cell target (default 3, max 8)
 *
 * Body (optional): { skillboard_id?: string } — restrict to one board.
 *
 * Permission: admin tier or above.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminTierApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  skillboardAuthoringJobs,
  skillboards,
  skills,
  tasks,
  type AuthoringJobType,
  type PerformanceLevel,
  type SeniorityBand,
} from "@/lib/db/schema";

const BANDS: SeniorityBand[] = ["junior", "mid", "senior"];
const LEVELS: PerformanceLevel[] = ["below", "nh", "g", "p", "tp"];

const inputSchema = z
  .object({ skillboard_id: z.string().uuid().optional() })
  .optional();

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAdminTierApi();
  if (!auth.user) return auth.unauthorized;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const targetParam = Number(url.searchParams.get("target") ?? "3");
  const target = Math.max(1, Math.min(8, Number.isFinite(targetParam) ? targetParam : 3));

  let input: z.infer<typeof inputSchema> = undefined;
  try {
    const body = await req.json().catch(() => ({}));
    input = inputSchema.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Load active skillboards (optionally scoped to one) + their tasks +
  // the validation bank assessment id linked by specialisation.
  const activeBoards = await db
    .select({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
    })
    .from(skillboards)
    .where(
      input?.skillboard_id
        ? and(
            eq(skillboards.id, input.skillboard_id),
            sql`${skillboards.activatedAt} IS NOT NULL`,
          )
        : sql`${skillboards.activatedAt} IS NOT NULL`,
    );

  if (activeBoards.length === 0) {
    return NextResponse.json({
      swept: 0,
      cells_scanned: 0,
      cells_short: 0,
      jobs_enqueued: 0,
      per_board: [],
    });
  }

  const boardIds = activeBoards.map((b) => b.id);

  // Tasks for all in-scope boards.
  const taskRows = await db
    .select({
      id: tasks.id,
      skillboardId: skills.skillboardId,
    })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(inArray(skills.skillboardId, boardIds));

  const tasksByBoard = new Map<string, string[]>();
  for (const t of taskRows) {
    if (!t.skillboardId) continue;
    const list = tasksByBoard.get(t.skillboardId) ?? [];
    list.push(t.id);
    tasksByBoard.set(t.skillboardId, list);
  }

  // Counts of questions per (task_id, band, level) across the whole
  // questions table — one query, aggregated in memory below.
  const questionRows = await db
    .select({
      taskId: questions.taskId,
      band: questions.band,
      level: questions.level,
    })
    .from(questions)
    .where(
      inArray(
        questions.taskId,
        taskRows.map((t) => t.id),
      ),
    );
  const cellCount = new Map<string, number>();
  const cellKey = (taskId: string, band: SeniorityBand, level: PerformanceLevel) =>
    `${taskId}|${band}|${level}`;
  for (const q of questionRows) {
    if (!q.taskId || !q.band || !q.level) continue;
    const k = cellKey(q.taskId, q.band as SeniorityBand, q.level as PerformanceLevel);
    cellCount.set(k, (cellCount.get(k) ?? 0) + 1);
  }

  // In-flight jobs for these boards to avoid double-enqueue.
  const pending = await db
    .select({
      skillboardId: skillboardAuthoringJobs.skillboardId,
      taskId: skillboardAuthoringJobs.taskId,
      result: skillboardAuthoringJobs.result,
      status: skillboardAuthoringJobs.status,
    })
    .from(skillboardAuthoringJobs)
    .where(
      and(
        inArray(skillboardAuthoringJobs.skillboardId, boardIds),
        inArray(skillboardAuthoringJobs.status, ["pending", "in_progress"]),
      ),
    );
  const inFlight = new Set<string>();
  for (const p of pending) {
    const payload = (p.result ?? {}) as {
      band?: SeniorityBand;
      level?: PerformanceLevel;
    };
    if (p.taskId && payload.band && payload.level) {
      inFlight.add(cellKey(p.taskId, payload.band, payload.level));
    }
  }

  // Walk the plan.
  const perBoard: Array<{
    skillboard_id: string;
    specialisation: string;
    cells_short: number;
    jobs_enqueued: number;
  }> = [];
  const jobsToInsert: {
    skillboardId: string;
    jobType: AuthoringJobType;
    taskId: string;
    result: unknown;
  }[] = [];
  let cellsScanned = 0;
  let cellsShort = 0;

  for (const board of activeBoards) {
    const boardTasks = tasksByBoard.get(board.id) ?? [];
    let boardShort = 0;
    let boardEnqueued = 0;
    for (const tId of boardTasks) {
      for (const b of BANDS) {
        for (const l of LEVELS) {
          cellsScanned += 1;
          const k = cellKey(tId, b, l);
          const have = cellCount.get(k) ?? 0;
          if (have >= target) continue;
          boardShort += 1;
          cellsShort += 1;
          if (inFlight.has(k)) continue;
          const missing = target - have;
          jobsToInsert.push({
            skillboardId: board.id,
            jobType: "bank_seed" as AuthoringJobType,
            taskId: tId,
            result: {
              specialisation: board.specialisation,
              band: b,
              level: l,
              task_id: tId,
              questions_per_cell: missing,
              auto_approve: true,
              backfill: true,
            },
          });
          boardEnqueued += 1;
        }
      }
    }
    perBoard.push({
      skillboard_id: board.id,
      specialisation: board.specialisation,
      cells_short: boardShort,
      jobs_enqueued: boardEnqueued,
    });
  }

  let jobsEnqueued = 0;
  if (!dryRun && jobsToInsert.length > 0) {
    for (let i = 0; i < jobsToInsert.length; i += 500) {
      await db
        .insert(skillboardAuthoringJobs)
        .values(jobsToInsert.slice(i, i + 500));
    }
    jobsEnqueued = jobsToInsert.length;
  }

  void assessments; // reserved for a future step that reports bank size

  return NextResponse.json({
    dry_run: dryRun,
    target_per_cell: target,
    swept: activeBoards.length,
    cells_scanned: cellsScanned,
    cells_short: cellsShort,
    jobs_enqueued: jobsEnqueued,
    jobs_planned: jobsToInsert.length,
    estimated_cost_usd: Number((jobsToInsert.length * 0.05).toFixed(2)),
    per_board: perBoard,
  });
}
