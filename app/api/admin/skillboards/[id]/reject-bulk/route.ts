/**
 * POST /api/admin/skillboards/[id]/reject-bulk
 *
 * Reject all cells under one scope with a SINGLE rejection note that
 * applies to every cell. Optionally enqueues each rejected cell for
 * Claude regeneration immediately (default: yes).
 *
 * Body:
 *   { scope: 'row', task_id, rejection_notes, auto_regenerate? }
 *   { scope: 'skill', skill_id, rejection_notes, auto_regenerate? }
 *   { scope: 'all', rejection_notes, auto_regenerate? }
 *
 * Reject scope:
 *   - Only flips cells currently in `pending` or `approved` state to
 *     `rejected`. Cells already `rejected` are left alone (their notes
 *     are not overwritten).
 *
 * Permission: Learning Expert.
 */

import { and, eq, inArray, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  levelExpectations,
  skillboardAuthoringJobs,
  skills,
  tasks,
  type AuthoringJobType,
} from "@/lib/db/schema";

/**
 * regen_mode controls the regeneration follow-up:
 *   - 'none': reject only; no regen jobs created
 *   - 'stage': create regen jobs but PAUSE them — admin reviews + clicks Start
 *     in the staged-regens banner. Recommended default (safer; lets admin
 *     verify scope before spending Opus credit).
 *   - 'immediate': create regen jobs in pending state, worker picks them up now
 */
const regenMode = z.enum(["none", "stage", "immediate"]).default("stage");

const inputSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("row"),
    task_id: z.string().uuid(),
    rejection_notes: z.string().trim().min(20).max(1000),
    regen_mode: regenMode,
  }),
  z.object({
    scope: z.literal("skill"),
    skill_id: z.string().uuid(),
    rejection_notes: z.string().trim().min(20).max(1000),
    regen_mode: regenMode,
  }),
  z.object({
    scope: z.literal("all"),
    rejection_notes: z.string().trim().min(20).max(1000),
    regen_mode: regenMode,
  }),
]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id: skillboardId } = await context.params;

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

  // Resolve the cell ids in scope.
  let cellIds: string[] = [];
  if (input.scope === "row") {
    const rows = await db
      .select({ id: levelExpectations.id })
      .from(levelExpectations)
      .where(
        and(
          eq(levelExpectations.taskId, input.task_id),
          ne(levelExpectations.approvalState, "rejected"),
        ),
      );
    cellIds = rows.map((r) => r.id);
  } else if (input.scope === "skill") {
    const taskRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.skillId, input.skill_id));
    if (taskRows.length === 0) {
      return NextResponse.json({ rejected: 0, enqueued: 0 });
    }
    const rows = await db
      .select({ id: levelExpectations.id })
      .from(levelExpectations)
      .where(
        and(
          inArray(
            levelExpectations.taskId,
            taskRows.map((t) => t.id),
          ),
          ne(levelExpectations.approvalState, "rejected"),
        ),
      );
    cellIds = rows.map((r) => r.id);
  } else {
    // scope === "all"
    const taskRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(skills, eq(skills.id, tasks.skillId))
      .where(eq(skills.skillboardId, skillboardId));
    if (taskRows.length === 0) {
      return NextResponse.json({ rejected: 0, enqueued: 0 });
    }
    const rows = await db
      .select({ id: levelExpectations.id })
      .from(levelExpectations)
      .where(
        and(
          inArray(
            levelExpectations.taskId,
            taskRows.map((t) => t.id),
          ),
          ne(levelExpectations.approvalState, "rejected"),
        ),
      );
    cellIds = rows.map((r) => r.id);
  }

  if (cellIds.length === 0) {
    return NextResponse.json({ rejected: 0, enqueued: 0 });
  }

  // Bulk flip to rejected, applying the same note to every cell.
  await db
    .update(levelExpectations)
    .set({
      approvalState: "rejected",
      rejectionNotes: input.rejection_notes,
      approvedBy: auth.session.admin.id,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(inArray(levelExpectations.id, cellIds));

  // Enqueue regeneration jobs based on regen_mode.
  //   none      → skip; admin will re-author manually
  //   stage     → insert with paused_until_review=true; banner appears
  //               so admin can review scope before spending Opus credit
  //   immediate → insert as normal; worker picks up on next poll
  let enqueued = 0;
  let staged = 0;
  if (input.regen_mode !== "none") {
    const pause = input.regen_mode === "stage";
    await db.insert(skillboardAuthoringJobs).values(
      cellIds.map((cellId) => ({
        skillboardId,
        jobType: "cell_regeneration" as AuthoringJobType,
        levelExpectationId: cellId,
        pausedUntilReview: pause,
      })),
    );
    if (pause) staged = cellIds.length;
    else enqueued = cellIds.length;
  }

  return NextResponse.json({
    rejected: cellIds.length,
    enqueued,
    staged,
    regen_mode: input.regen_mode,
  });
}
