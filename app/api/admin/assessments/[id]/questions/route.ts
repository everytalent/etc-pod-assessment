/**
 * POST /api/admin/assessments/[id]/questions — create a new question on the
 * assessment, appended to the end (max(order_index) + 1).
 */

import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { assessments, questions } from "@/lib/db/schema";
import { upsertQuestionSchema } from "@/lib/admin/validators";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = upsertQuestionSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [exists] = await db
    .select({ id: assessments.id })
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!exists) {
    return NextResponse.json({ error: "assessment_not_found" }, { status: 404 });
  }

  const [{ next }] = await db
    .select({
      next: sql<number>`COALESCE(MAX(${questions.orderIndex}), -1) + 1`,
    })
    .from(questions)
    .where(eq(questions.assessmentId, id));

  const [created] = await db
    .insert(questions)
    .values({
      assessmentId: id,
      orderIndex: next,
      type: input.type,
      questionText: input.questionText,
      options: input.options,
      correctAnswer: input.correctAnswer,
      points: input.points,
      negativePoints: input.negativePoints,
      timerEnabled: input.timerEnabled,
      timeLimitSeconds: input.timeLimitSeconds,
      timeoutAction: input.timeoutAction,
      required: input.required,
      section: input.section,
    })
    .returning();

  return NextResponse.json({ question: created }, { status: 201 });
}
