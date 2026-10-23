/**
 * GET /api/internal/course-assessments/sessions/:session_id?learner_ref=
 *
 * The state and score of a learner's session, read back by Training.
 * The learner_ref must match the one the session was minted with, so
 * a session id alone reveals nothing.
 */

import { NextResponse } from "next/server";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { courseSessionResult } from "@/lib/engines/assessment/course-assessments";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ session_id: string }> }): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { session_id } = await params;
  const learnerRef = new URL(req.url).searchParams.get("learner_ref") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(session_id) || !learnerRef) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const result = await courseSessionResult(session_id, learnerRef);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
