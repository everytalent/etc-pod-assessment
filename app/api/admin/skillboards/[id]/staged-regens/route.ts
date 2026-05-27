/**
 * Staged regenerations management — used by the
 * "Stage for review" mode of bulk-reject.
 *
 *   POST /api/admin/skillboards/[id]/staged-regens
 *     body: { action: 'start' | 'cancel' }
 *
 *   - start  → flips paused_until_review=false on every paused regen
 *              job for this skillboard; the worker picks them up on
 *              the next poll
 *   - cancel → deletes the paused jobs entirely (no Opus spend)
 *
 * Permission: Learning Expert (matches who created the rejections).
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { skillboardAuthoringJobs } from "@/lib/db/schema";

const inputSchema = z.object({
  action: z.enum(["start", "cancel"]),
});

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

  const pausedFilter = and(
    eq(skillboardAuthoringJobs.skillboardId, skillboardId),
    eq(skillboardAuthoringJobs.status, "pending"),
    eq(skillboardAuthoringJobs.pausedUntilReview, true),
  );

  if (input.action === "start") {
    const result = await db
      .update(skillboardAuthoringJobs)
      .set({ pausedUntilReview: false })
      .where(pausedFilter)
      .returning({ id: skillboardAuthoringJobs.id });
    return NextResponse.json({ released: result.length });
  }

  // action === "cancel"
  const result = await db
    .delete(skillboardAuthoringJobs)
    .where(pausedFilter)
    .returning({ id: skillboardAuthoringJobs.id });
  return NextResponse.json({ cancelled: result.length });
}
