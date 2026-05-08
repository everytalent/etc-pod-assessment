/**
 * GET /api/admin/responses/[id] — drill-in detail for one response.
 *
 * Returns the response, its answers (joined with the question text + options
 * + correct answer for review purposes), and the branching `path` from
 * metadata. Reviewers see correct_answer here — this is the admin track,
 * not the candidate UI.
 */

import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, questions, responses } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, id))
    .limit(1);
  if (!response) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const answerRows = await db
    .select({
      answerId: answers.id,
      questionId: answers.questionId,
      selectedOptions: answers.selectedOptions,
      timeSpentSeconds: answers.timeSpentSeconds,
      timedOut: answers.timedOut,
      scoreAwarded: answers.scoreAwarded,
      answeredAt: answers.answeredAt,
      questionText: questions.questionText,
      questionType: questions.type,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      orderIndex: questions.orderIndex,
      points: questions.points,
      negativePoints: questions.negativePoints,
      section: questions.section,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, id))
    .orderBy(asc(answers.answeredAt));

  return NextResponse.json({ response, answers: answerRows });
}
