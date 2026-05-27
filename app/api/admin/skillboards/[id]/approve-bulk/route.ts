/**
 * POST /api/admin/skillboards/[id]/approve-bulk
 *
 * Bulk-approve all PENDING cells under one of three scopes:
 *   { scope: 'row',   task_id: uuid }   — every cell of one task
 *   { scope: 'skill', skill_id: uuid }  — every cell of every task in one skill
 *   { scope: 'all' }                    — every pending cell on the board
 *
 * Rejected cells are deliberately NOT touched — reviewer must
 * edit-or-regen those explicitly. PRD §1b.
 *
 * Permission: Learning Expert.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  bulkApproveAllPending,
  bulkApproveBySkill,
  bulkApproveByTask,
} from "@/lib/engines/assessment/skillboards/repository";
import { bulkApproveInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  let input;
  try {
    input = bulkApproveInputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const approver = auth.session.admin.id;
  let approved = 0;
  if (input.scope === "row") {
    approved = await bulkApproveByTask({
      taskId: input.task_id,
      approvedBy: approver,
    });
  } else if (input.scope === "skill") {
    approved = await bulkApproveBySkill({
      skillId: input.skill_id,
      approvedBy: approver,
    });
  } else {
    approved = await bulkApproveAllPending({
      skillboardId: id,
      approvedBy: approver,
    });
  }

  return NextResponse.json({ approved });
}
