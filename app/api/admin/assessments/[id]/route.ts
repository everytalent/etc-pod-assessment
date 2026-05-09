/**
 * GET    /api/admin/assessments/[id] — full detail with questions + rules.
 * PATCH  /api/admin/assessments/[id] — update metadata.
 * DELETE /api/admin/assessments/[id] — hard delete (cascades).
 */

import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAdminApi, requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { assessments, branchingRules, questions } from "@/lib/db/schema";
import { upsertAssessmentSchema } from "@/lib/admin/validators";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [assessment] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [qs, rs] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, id))
      .orderBy(asc(questions.orderIndex)),
    db
      .select()
      .from(branchingRules)
      .where(eq(branchingRules.assessmentId, id)),
  ]);

  return NextResponse.json({
    assessment,
    questions: qs,
    branchingRules: rs,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

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

  const [updated] = await db
    .update(assessments)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(assessments.id, id))
    .returning();
  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ assessment: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;
  const deleted = await db
    .delete(assessments)
    .where(eq(assessments.id, id))
    .returning({ id: assessments.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: deleted[0]!.id });
}
