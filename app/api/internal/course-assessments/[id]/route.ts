/**
 * GET /api/internal/course-assessments/:skillboard_id
 *
 * Where the course's board stands: authoring, bank empty, or ready to
 * mint sessions. An activated board with no questions has its seed
 * jobs queued as a side effect, so polling here is also a nudge.
 */

import { NextResponse } from "next/server";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { courseAssessmentStatus } from "@/lib/engines/assessment/course-assessments";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const status = await courseAssessmentStatus(id);
  if (!status) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(status);
}
