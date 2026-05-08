/**
 * GET  /api/admin/assessments — list with response counts + avg score.
 * POST /api/admin/assessments — create a new draft assessment.
 *
 * Both gated by middleware + a defence-in-depth Supabase user check.
 */

import { count, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { assessments, responses } from "@/lib/db/schema";
import { upsertAssessmentSchema } from "@/lib/admin/validators";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  const rows = await db
    .select({
      id: assessments.id,
      title: assessments.title,
      slug: assessments.slug,
      roleType: assessments.roleType,
      status: assessments.status,
      passThreshold: assessments.passThreshold,
      createdAt: assessments.createdAt,
      updatedAt: assessments.updatedAt,
      responseCount: count(responses.id),
      submittedCount:
        sql<number>`COUNT(CASE WHEN ${responses.status} = 'submitted' THEN 1 END)::int`,
      avgScore: sql<number | null>`AVG(${responses.totalScore})`,
    })
    .from(assessments)
    .leftJoin(responses, eq(responses.assessmentId, assessments.id))
    .groupBy(assessments.id)
    .orderBy(desc(assessments.updatedAt));

  return NextResponse.json({ assessments: rows });
}

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = upsertAssessmentSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [created] = await db
    .insert(assessments)
    .values({
      title: input.title,
      slug: input.slug,
      roleType: input.roleType,
      status: input.status,
      passThreshold: input.passThreshold,
      introText: input.introText,
      outroText: input.outroText,
    })
    .returning();

  return NextResponse.json({ assessment: created }, { status: 201 });
}
