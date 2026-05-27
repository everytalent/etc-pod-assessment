/**
 * GET /api/admin/skillboards/[id]/authoring-status
 *
 * Polled by the admin UI to drive the progress bar. Lightweight (one
 * COUNT query) so a 2-3s polling cadence is fine.
 */

import { NextResponse } from "next/server";

import { requireSkillboardAccessApi } from "@/lib/auth/admin";
import { getAuthoringStatus } from "@/lib/engines/assessment/skillboards/claude-author";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const status = await getAuthoringStatus(id);
  return NextResponse.json(status);
}
