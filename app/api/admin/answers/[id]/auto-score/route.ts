/**
 * POST /api/admin/answers/[id]/auto-score
 *
 * Calls Gemini to suggest a score for an open-ended answer using the
 * question's authored rubric. Does NOT persist the score — the response
 * payload is intentionally a "suggestion" the admin reviews and accepts
 * (or overrides) via the existing PATCH /score endpoint.
 *
 * Pre-conditions:
 *   - question.type === 'open'
 *   - question.scoring_rubric is set
 *   - answer has either a transcript or a textResponse to score against
 *
 * Permission: editor or above.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireEditorApi } from "@/lib/auth/admin";
import { scoreOpenEnded } from "@/lib/ai/gemini";
import { db } from "@/lib/db/client";
import { answers, questions } from "@/lib/db/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [row] = await db
    .select({
      answerId: answers.id,
      transcript: answers.transcript,
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      questionType: questions.type,
      questionText: questions.questionText,
      rubric: questions.scoringRubric,
      points: questions.points,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.questionType !== "open") {
    return NextResponse.json(
      { error: "wrong_type", message: "Auto-score is only valid on open-ended questions." },
      { status: 400 },
    );
  }
  if (!row.rubric || row.rubric.trim() === "") {
    return NextResponse.json(
      {
        error: "no_rubric",
        message:
          "This question has no scoring rubric. Add one in the question editor before auto-scoring.",
      },
      { status: 400 },
    );
  }

  // Prefer the transcript when the candidate spoke; fall back to
  // textResponse when they typed instead. If both are empty, score 0.
  const candidateAnswer = (row.transcript ?? "").trim() || (row.textResponse ?? "").trim();
  if (!candidateAnswer && !row.audioPath) {
    return NextResponse.json({
      suggestion: {
        suggestedScore: 0,
        rationale: "Candidate submitted no response.",
        hits: [],
        misses: [],
        redFlagsTriggered: [],
      },
    });
  }
  if (!candidateAnswer && row.audioPath) {
    return NextResponse.json(
      {
        error: "needs_transcript",
        message:
          "Voice answer hasn't been transcribed yet. Click Transcribe first, then Suggest score.",
      },
      { status: 409 },
    );
  }

  try {
    const suggestion = await scoreOpenEnded({
      questionText: row.questionText,
      rubric: row.rubric,
      candidateAnswer,
      maxPoints: row.points,
    });
    return NextResponse.json({ suggestion });
  } catch (err) {
    return NextResponse.json(
      {
        error: "ai_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
