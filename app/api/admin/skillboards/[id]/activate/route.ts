/**
 * POST /api/admin/skillboards/[id]/activate
 *
 * Sets `activated_at = now()` after verifying every level_expectations
 * cell is `approved`. PRD §1b — partial approval is not enough.
 *
 * Permission: Learning Expert (editor+ with can_approve_skillboards).
 */

import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  checkActivationReadiness,
  markActivated,
} from "@/lib/engines/assessment/skillboards/activator";

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
  return NextResponse.json({ activated: true });
}
