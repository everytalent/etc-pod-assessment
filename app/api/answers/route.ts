/**
 * POST /api/answers — submit one answer in a candidate session.
 *
 * Body: { question_id, selected_options[], time_spent_seconds }
 * Cookie: etc_session = response_id
 *
 * 1. Validate input + cookie (401 if missing).
 * 2. Confirm the response is still in_progress.
 * 3. Confirm the question belongs to this assessment and isn't already answered
 *    (idempotent: re-submitting the same q is a 409).
 * 4. Cross-check timer: server delta vs client report (PRD §5.2).
 * 5. Score via the pure scoring layer.
 * 6. Persist the answer row.
 * 7. Ask the engine for the next question.
 *    - If end → finalise the response, clear cookie, return is_complete.
 *    - If next → update last_question_shown_at, return the sanitised question.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { db } from "@/lib/db/client";
import {
  answers,
  questions,
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";
import {
  finalizeResponse,
  getNextQuestion,
} from "@/lib/assessment/engine";
import {
  getCandidateQuestion,
  getRunningScore,
} from "@/lib/assessment/queries";
import { scoreAnswer } from "@/lib/assessment/scoring";
import {
  submitAnswerSchema,
  type AnswerResponse,
} from "@/lib/assessment/validators";
import {
  clearCandidateSession,
  getCandidateSession,
} from "@/lib/session";

/**
 * Allowable wall-clock drift between the client-reported time_spent and the
 * server's measured delta before we treat the client number as untrustworthy
 * (PRD §5.2: "If client clock drift > 3s, server's truth wins").
 */
const TIMER_DRIFT_TOLERANCE_SECONDS = 3;

export async function POST(req: Request) {
  const responseId = await getCandidateSession();
  if (!responseId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = submitAnswerSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!response) {
    await clearCandidateSession();
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (response.status !== "in_progress") {
    return NextResponse.json(
      { error: "session_not_in_progress", status: response.status },
      { status: 409 },
    );
  }

  const [question] = await db
    .select()
    .from(questions)
    .where(
      and(
        eq(questions.id, input.question_id),
        eq(questions.assessmentId, response.assessmentId),
      ),
    )
    .limit(1);

  if (!question) {
    return NextResponse.json(
      { error: "question_not_found_for_assessment" },
      { status: 404 },
    );
  }

  // Reject duplicate submissions for the same question — keeps the answer set
  // consistent with the engine's "already answered → end" guard.
  const [existing] = await db
    .select({ id: answers.id })
    .from(answers)
    .where(
      and(
        eq(answers.responseId, responseId),
        eq(answers.questionId, question.id),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "question_already_answered" },
      { status: 409 },
    );
  }

  /* ---- Timer cross-check (PRD §5.2) ---- */
  const now = new Date();
  const lastShownIso = response.metadata.last_question_shown_at;
  const serverDeltaSeconds = lastShownIso
    ? Math.max(0, (now.getTime() - new Date(lastShownIso).getTime()) / 1000)
    : input.time_spent_seconds;

  const drift = Math.abs(input.time_spent_seconds - serverDeltaSeconds);
  const effectiveTimeSpent =
    drift > TIMER_DRIFT_TOLERANCE_SECONDS
      ? serverDeltaSeconds
      : Math.min(input.time_spent_seconds, serverDeltaSeconds);

  const timedOut =
    question.timerEnabled &&
    typeof question.timeLimitSeconds === "number" &&
    effectiveTimeSpent > question.timeLimitSeconds;

  /* ---- Score + persist ---- */
  // Open-ended (text or voice) cannot auto-score — score_awarded stays at 0
  // until an admin reviews. Other types score immediately via the pure layer.
  const isOpenEnded = question.type === "open";
  const scoreAwarded = isOpenEnded
    ? 0
    : scoreAnswer(question, input.selected_options, timedOut);

  await db.insert(answers).values({
    responseId,
    questionId: question.id,
    selectedOptions: input.selected_options,
    textResponse: input.text_response ?? null,
    audioPath: input.audio_path ?? null,
    audioDurationSeconds: input.audio_duration_seconds ?? null,
    timeSpentSeconds: Math.round(effectiveTimeSpent),
    timedOut,
    scoreAwarded,
    answeredAt: now,
  });

  /* ---- Determine next + persist metadata ---- */
  const next = await getNextQuestion(responseId);

  if (next.kind === "end") {
    const final = await finalizeResponse(responseId);
    await clearCandidateSession();
    const payload: AnswerResponse & { total_score: number; pass: boolean } = {
      score_so_far: final.totalScore,
      next_question: null,
      is_complete: true,
      total_score: final.totalScore,
      pass: final.pass,
    };
    return NextResponse.json(payload);
  }

  const updatedMetadata: ResponseMetadata = {
    ...response.metadata,
    last_question_shown_at: new Date().toISOString(),
    path: [...(response.metadata.path ?? []), question.id],
  };
  await db
    .update(responses)
    .set({ metadata: updatedMetadata })
    .where(eq(responses.id, responseId));

  const [nextQuestion, runningScore] = await Promise.all([
    getCandidateQuestion(next.questionId),
    getRunningScore(responseId),
  ]);

  const payload: AnswerResponse = {
    score_so_far: runningScore,
    next_question: nextQuestion,
    is_complete: false,
  };
  return NextResponse.json(payload);
}
