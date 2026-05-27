/**
 * POST /api/admin/skillboards/[id]/process-next-job
 *
 * Worker tick — claims the next pending job in this skillboard's queue
 * and runs it (single Opus call inside).
 *
 * Called by:
 *   - The admin UI poll loop (every 2-3s while the detail page is open)
 *   - A Netlify scheduled function (every 5 min, fallback for closed tabs)
 *
 * Returns 200 with `{processed, jobId, success}` either way. The
 * client loops until `processed === false`.
 */

import { NextResponse } from "next/server";

import { requireSkillboardAccessApi } from "@/lib/auth/admin";
import { processNextAuthoringJob } from "@/lib/engines/assessment/skillboards/claude-author";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const result = await processNextAuthoringJob(id);
  return NextResponse.json(result);
}
