/**
 * POST /api/admin/skillboards/[id]/activate
 *
 * Sets `activated_at = now()` after verifying every level_expectations
 * cell is `approved`. PRD §1b — partial approval is not enough.
 *
 * v1.1 (2026-06-18): On activation, also enqueue a `question_seed` job
 * for every (band × level × task) cell on the board. Each job runs
 * Opus to generate ~3 candidate questions for the cell and (per the
 * existing worker's auto_approve default) inserts them straight into
 * the validation bank assessment — no human re-approval needed.
 *
 * Without this, activated skillboards had ZERO questions in their
 * validation bank, which sent every candidate straight to the
 * "Submitted" screen after Onboarding handed them off.
 *
 * Permission: Learning Expert (editor+ with can_approve_skillboards).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
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
import {
  checkActivationReadiness,
  markActivated,
} from "@/lib/engines/assessment/skillboards/activator";

const BANDS: SeniorityBand[] = ["junior", "mid", "senior"];
const LEVELS: PerformanceLevel[] = ["below", "nh", "g", "p", "tp"];

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const check = await checkActivationReadiness(id);
  if (!check.ready) {
    return NextResponse.json(
      {
        error: "not_ready_for_activation",
        ...check,
      },
      { status: 422 },
    );
  }

  await markActivated(id);

  // Enqueue auto-seed jobs — one per (band × level × task) cell.
  // The worker picks them up on its next poll (or the Netlify cron
  // tick) and runs them in parallel up to the worker concurrency cap.
  // Each job auto-approves its output into the validation bank.
  const [board] = await db
    .select({
      specialisation: skillboards.specialisation,
    })
    .from(skillboards)
    .where(eq(skillboards.id, id))
    .limit(1);

  const taskRows = board
    ? await db
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(skills, eq(skills.id, tasks.skillId))
        .where(eq(skills.skillboardId, id))
    : [];

  let enqueued = 0;
  if (board && taskRows.length > 0) {
    const rows: {
      skillboardId: string;
      jobType: AuthoringJobType;
      taskId: string;
      result: unknown;
    }[] = [];
    for (const t of taskRows) {
      for (const b of BANDS) {
        for (const l of LEVELS) {
          rows.push({
            skillboardId: id,
            jobType: "question_seed" as AuthoringJobType,
            taskId: t.id,
            // The worker reads the payload from the `result` column
            // (mis-named but established). auto_approve defaults to
            // true on the worker side; we set it explicitly for
            // clarity.
            result: {
              specialisation: board.specialisation,
              band: b,
              level: l,
              task_id: t.id,
              questions_per_cell: 3,
              auto_approve: true,
            },
          });
        }
      }
    }
    // Chunk-insert in groups of 500 to stay well under Postgres parameter
    // limits even for a 405-cell board.
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(skillboardAuthoringJobs).values(rows.slice(i, i + 500));
    }
    enqueued = rows.length;
  }

  return NextResponse.json({
    activated: true,
    seed_jobs_enqueued: enqueued,
    estimated_cost_usd: Number((enqueued * 0.05).toFixed(2)),
  });
}
