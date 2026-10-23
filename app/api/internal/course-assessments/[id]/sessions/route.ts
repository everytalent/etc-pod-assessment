/**
 * POST /api/internal/course-assessments/:skillboard_id/sessions
 *
 * A learner's session on the course's final assessment. Training owns
 * the learner, so the body carries who they are; no onboarding profile
 * is fetched. Returns the take URL. An open session for the same
 * learner is returned again rather than duplicated.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { mintCourseSession } from "@/lib/engines/assessment/course-assessments";

const Input = z.object({
  learner_ref: z.string().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().min(1).max(120),
  band: z.enum(["junior", "mid", "senior"]).default("junior"),
  redirect_url: z.string().url().max(500).optional(),
  expires_in_days: z.number().int().min(1).max(30).default(14),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await mintCourseSession({
    skillboardId: id,
    learnerRef: parsed.data.learner_ref,
    email: parsed.data.email,
    name: parsed.data.name,
    band: parsed.data.band,
    redirectUrl: parsed.data.redirect_url,
    expiresInDays: parsed.data.expires_in_days,
  });
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result, { status: result.reused ? 200 : 201 });
}
