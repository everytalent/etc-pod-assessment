/**
 * POST /api/admin/level-expectations/[id]/approve
 *
 * Approve a single cell as-is. Permission: Learning Expert.
 */

import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  approveCell,
  getLevelExpectation,
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

  if (cell.expectationText.trim().length === 0) {
    return NextResponse.json(
      {
        error: "empty_cell",
        message: "Can't approve an empty cell. Edit it or wait for the Claude pass to fill it.",
      },
      { status: 422 },
    );
  }

  await approveCell({ cellId: id, approvedBy: auth.session.admin.id });
  return NextResponse.json({ approved: true });
}
