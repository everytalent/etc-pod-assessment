/**
 * POST /api/admin/skillboards/[id]/deactivate
 *
 * Unstamps `activated_at`. CAT engine will stop picking questions from
 * this board. Used when a reviewer spots a post-activation issue.
 *
 * Permission: Learning Expert.
 */

import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import { markDeactivated } from "@/lib/engines/assessment/skillboards/activator";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  await markDeactivated(id);
  return NextResponse.json({ deactivated: true });
}
