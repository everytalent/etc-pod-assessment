/**
 * POST /api/admin/level-expectations/[id]/regenerate
 *
 * Send a rejected cell back to Claude with the rejection notes.
 * Enqueues a `cell_regeneration` job; the worker picks it up on the
 * next process-next-job tick.
 *
 * Caps at MAX_REGENERATIONS_PER_CELL (3) — beyond that the reviewer
 * must edit-then-approve or escalate.
 *
 * Permission: Learning Expert (the same actor who rejected can also
 * regenerate). Pre-condition: cell must be in `rejected` state with
 * rejection_notes populated.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { skills, tasks } from "@/lib/db/schema";
import { enqueueCellRegeneration } from "@/lib/engines/assessment/skillboards/claude-author";
import {
  bumpRegenerationCount,
  getLevelExpectation,
  isRegenerationCapped,
} from "@/lib/engines/assessment/skillboards/repository";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  const cell = await getLevelExpectation(id);
  if (!cell) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (cell.approvalState !== "rejected") {
    return NextResponse.json(
      {
        error: "wrong_state",
        message: `Cell is ${cell.approvalState}, not rejected. Reject it first.`,
      },
      { status: 422 },
    );
  }
  if (!cell.rejectionNotes || cell.rejectionNotes.trim().length === 0) {
    return NextResponse.json(
      {
        error: "missing_rejection_notes",
        message: "Cell was rejected without notes — can't regenerate without guidance.",
      },
      { status: 422 },
    );
  }
  if (isRegenerationCapped(cell.regenerationCount)) {
    return NextResponse.json(
      {
        error: "regen_cap_reached",
        count: cell.regenerationCount,
        message: "Max 3 regenerations per cell. Edit it manually or escalate.",
      },
      { status: 422 },
    );
  }

  // Bump the count BEFORE enqueueing so an immediate second click doesn't
  // double-spend.
  await bumpRegenerationCount(id);

  // Resolve the skillboard_id for the job row.
  const [{ skillboardId }] = await db
    .select({ skillboardId: skills.skillboardId })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(tasks.id, cell.taskId))
    .limit(1);

  const { jobId } = await enqueueCellRegeneration({
    skillboardId,
    levelExpectationId: id,
  });
  return NextResponse.json({ enqueued: true, job_id: jobId });
}
