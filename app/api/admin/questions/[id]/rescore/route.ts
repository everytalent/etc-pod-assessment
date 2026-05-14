/**
 * POST /api/admin/questions/[id]/rescore
 *
 * Re-runs auto-scoring against every existing answer for this question
 * using the question's CURRENT definition (correctAnswer, points,
 * negativePoints, timeoutAction). Use this after fixing a wrong "right
 * answer" or tweaking points so existing responses pick up the change.
 *
 * Only applies to auto-graded types (mcq, true_false, file, formula).
 * Open / voice answers carry human (or AI) scores and aren't touched
 * here — editing the rubric on those doesn't change a saved grade.
 *
 * Per affected response, totals are recomputed via the shared helper so
 * the dashboard pass/fail flips correctly. In-progress responses are
 * left alone (their totals are written at submit time).
 *
 * Auth: editor or above.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import { scoreAnswer } from "@/lib/assessment/scoring";
import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, questions } from "@/lib/db/schema";

const AUTO_GRADED = new Set(["mcq", "true_false", "file", "formula"]);

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [question] = await db
    .select({
      id: questions.id,
      type: questions.type,
      correctAnswer: questions.correctAnswer,
      points: questions.points,
      negativePoints: questions.negativePoints,
      timeoutAction: questions.timeoutAction,
    })
    .from(questions)
    .where(eq(questions.id, id))
    .limit(1);
  if (!question) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!AUTO_GRADED.has(question.type)) {
    return NextResponse.json(
      {
        error: "not_auto_graded",
        message:
          "Open and voice answers are scored by a human (or AI) — there's no correctAnswer to rescore against.",
      },
      { status: 400 },
    );
  }

  const rows = await db
    .select({
      id: answers.id,
      responseId: answers.responseId,
      selectedOptions: answers.selectedOptions,
      timedOut: answers.timedOut,
      scoreAwarded: answers.scoreAwarded,
    })
    .from(answers)
    .where(eq(answers.questionId, id));

  let updated = 0;
  const affectedResponses = new Set<string>();
  for (const row of rows) {
    const newScore = scoreAnswer(
      {
        points: question.points,
        negativePoints: question.negativePoints,
        correctAnswer: question.correctAnswer,
        timeoutAction: question.timeoutAction,
      },
      row.selectedOptions,
      row.timedOut,
    );
    if (newScore !== row.scoreAwarded) {
      await db
        .update(answers)
        .set({ scoreAwarded: newScore })
        .where(eq(answers.id, row.id));
      updated += 1;
      affectedResponses.add(row.responseId);
    }
  }

  for (const responseId of affectedResponses) {
    await recomputeResponseTotals(responseId);
  }

  return NextResponse.json({
    examined: rows.length,
    updated,
    responses_recomputed: affectedResponses.size,
  });
}
