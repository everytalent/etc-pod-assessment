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
  assessments,
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
import { getTypeDef } from "@/lib/engines/assessment/question-types";
import { advanceValidationFlow } from "@/lib/engines/assessment/cat/validation-flow";
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

  /* ---- Load assessment to detect mode (fixed vs validation) ---- */
  const [assessment] = await db
    .select({
      mode: assessments.mode,
      specialisation: assessments.specialisation,
    })
    .from(assessments)
    .where(eq(assessments.id, response.assessmentId))
    .limit(1);

  /* ---- Score + persist ---- */
  // Three scoring paths:
  //   - Open / voice / file: AI-scored later; score_awarded = 0 now
  //   - Interactive types (slider, hotspot, sequence, matching, scenario, formula):
  //     use the type registry's deterministic auto-scorer
  //   - Legacy MCQ / T-F: existing scoreAnswer() path
  const isOpenEnded =
    question.type === "open" || question.type === "voice" || question.type === "file";

  let scoreAwarded = 0;
  let autoScoreResult: unknown = null;

  if (isOpenEnded) {
    scoreAwarded = 0;
  } else if (
    question.type === "mcq" ||
    question.type === "true_false"
  ) {
    scoreAwarded = scoreAnswer(question, input.selected_options, timedOut);
  } else {
    // Phase 2 interactive types — use the registry's auto-scorer.
    try {
      const def = getTypeDef(question.type);
      if (def.autoScore && input.structured_answer !== undefined) {
        const result = def.autoScore({
          config: question.interactiveConfig,
          answer: input.structured_answer,
          points: question.points,
        });
        if (result) {
          scoreAwarded = timedOut ? 0 : result.score;
          autoScoreResult = result;
        }
      }
    } catch (err) {
      console.warn(
        `[answers POST] auto-score failed for type ${question.type}:`,
        err instanceof Error ? err.message : "unknown",
      );
      // Fall through with scoreAwarded = 0; admin can review.
    }
  }

  const [insertedAnswer] = await db
    .insert(answers)
    .values({
      responseId,
      questionId: question.id,
      selectedOptions: input.selected_options,
      textResponse: input.text_response ?? null,
      audioPath: input.audio_path ?? null,
      audioDurationSeconds: input.audio_duration_seconds ?? null,
      recordingAttempted: input.recording_attempted ?? false,
      structuredAnswer: input.structured_answer ?? null,
      autoScoreResult: autoScoreResult ?? null,
      timeSpentSeconds: Math.round(effectiveTimeSpent),
      timedOut,
      scoreAwarded,
      answeredAt: now,
    })
    .returning({ id: answers.id });

  /* ---- Determine next + persist metadata ---- */
  // Hybrid dispatch: validation-mode goes through the CAT engine; fixed
  // (legacy) mode keeps the existing branching-rules path.
  let nextKind: "next" | "end";
  let nextQuestionId: string | null = null;

  if (assessment?.mode === "validation") {
    if (!assessment.specialisation) {
      return NextResponse.json(
        {
          error: "validation_assessment_missing_specialisation",
          message:
            "Validation-mode assessments must have a specialisation set.",
        },
        { status: 500 },
      );
    }
    // MVP: claimed band is read from response.metadata.claimed_band
    // (set by /api/sessions/select-specialisations — to be built).
    // Default to 'junior' so existing dev rows don't crash.
    const claimedBand =
      ((response.metadata as Record<string, unknown>).claimed_band as
        | "junior"
        | "mid"
        | "senior"
        | undefined) ?? "junior";
    const answered = (response.metadata.path ?? []).concat(question.id);
    const flow = await advanceValidationFlow({
      responseId,
      specialisation: assessment.specialisation,
      claimedBand,
      budget: 15, // MVP — single-spec budget; multi-spec uses PER_SPEC_BUDGET later
      lastAnswerId: insertedAnswer.id,
      answeredQuestionIds: answered,
    });
    nextKind = flow.kind;
    if (flow.kind === "next") nextQuestionId = flow.questionId;
  } else {
    const next = await getNextQuestion(responseId);
    nextKind = next.kind;
    if (next.kind === "next") nextQuestionId = next.questionId;
  }

  if (nextKind === "end") {
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
    nextQuestionId ? getCandidateQuestion(nextQuestionId) : Promise.resolve(null),
    getRunningScore(responseId),
  ]);

  const payload: AnswerResponse = {
    score_so_far: runningScore,
    next_question: nextQuestion,
    is_complete: false,
  };
  return NextResponse.json(payload);
}
