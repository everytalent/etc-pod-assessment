/**
 * POST /api/internal/course-assessments
 *
 * The Training Engine commissions the final assessment of a course by
 * sending its job parts. The course is mapped to an existing activated
 * skillboard when a role fits one, or a new skillboard is created from
 * the job parts (derived from any near matches) and queued for
 * structure authoring with auto-activate. Idempotent: the same course
 * gets the same board back.
 *
 * Auth: Bearer ETC_ASSESSMENT_SERVICE_TOKEN.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { commissionCourseAssessment } from "@/lib/engines/assessment/course-assessments";

const Input = z.object({
  course_ref: z.string().min(1).max(80),
  course_name: z.string().trim().min(1).max(200),
  description: z.string().max(4000).default(""),
  job_parts: z
    .array(
      z.object({
        role: z.string().trim().min(1).max(120),
        task: z.string().trim().min(1).max(200),
        can_do: z.string().max(400).default(""),
        band: z.enum(["new_hire", "growing", "pro"]).default("new_hire"),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }
  const result = await commissionCourseAssessment(parsed.data);
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
