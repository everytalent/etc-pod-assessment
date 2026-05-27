/**
 * PATCH /api/admin/level-expectations/[id]
 *
 * Inline-edit a cell. Sets synthesised=false (a human now owns the
 * text) and approves in one step — same actor who's trusted to edit
 * is trusted to approve their own edit.
 *
 * Permission: Learning Expert (since the edit auto-approves and
 * therefore directly affects what can activate).
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  editCellInline,
  getLevelExpectation,
} from "@/lib/engines/assessment/skillboards/repository";
import { patchLevelExpectationInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  let input;
  try {
    input = patchLevelExpectationInputSchema.parse(await req.json());
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

  await editCellInline({
    cellId: id,
    expectationText: input.expectation_text,
    editedBy: auth.session.admin.id,
  });
  return NextResponse.json({ updated: true, approved: true });
}
