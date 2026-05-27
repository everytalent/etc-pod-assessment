/**
 * POST /api/admin/level-expectations/[id]/reject
 *
 * Reject a cell with notes. Notes are required (≥20 chars) so the
 * regeneration prompt has substance to work with.
 *
 * Permission: Learning Expert.
 *
 * After rejection, the cell stays in the `rejected` state. Caller
 * separately POSTs /regenerate to enqueue a Claude regen job.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  getLevelExpectation,
  rejectCell,
} from "@/lib/engines/assessment/skillboards/repository";
import { rejectCellInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  let input;
  try {
    input = rejectCellInputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const cell = await getLevelExpectation(id);
  if (!cell) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await rejectCell({
    cellId: id,
    rejectionNotes: input.rejection_notes,
    rejectedBy: auth.session.admin.id,
  });
  return NextResponse.json({ rejected: true });
}
