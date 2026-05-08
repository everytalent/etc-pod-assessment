/**
 * PATCH  /api/admin/questions/[id] — update question.
 * DELETE /api/admin/questions/[id] — remove question (cascades to its rules + answers).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { questions } from "@/lib/db/schema";
import { upsertQuestionSchema } from "@/lib/admin/validators";

export async function PATCH(
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

  const [updated] = await db
    .update(questions)
    .set({
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
    .where(eq(questions.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ question: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;
  const removed = await db
    .delete(questions)
    .where(eq(questions.id, id))
    .returning({ id: questions.id });
  if (removed.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: removed[0]!.id });
}
