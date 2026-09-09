/**
 * GET /api/internal/skillboards/[id]/status
 *
 * Cross-engine polling companion to POST /api/internal/skillboards.
 * Structure authoring runs async on the cron worker, so the commissioning
 * engine (Training Engine's course wizard) polls here until the board is
 * populated before unlocking its own downstream editing UI.
 *
 * Same underlying read as the admin authoring-status route; service
 * token instead of an admin session.
 */

import { NextResponse } from "next/server";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { getAuthoringStatus } from "@/lib/engines/assessment/skillboards/claude-author";
import { getSkillboardById } from "@/lib/engines/assessment/skillboards/repository";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const { id } = await context.params;

  const board = await getSkillboardById(id);
  if (!board) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const status = await getAuthoringStatus(id);
  return NextResponse.json({
    skillboard_id: id,
    specialisation: board.specialisation,
    activated_at: board.activatedAt ?? null,
    ...status,
  });
}
