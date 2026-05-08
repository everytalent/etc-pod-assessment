/**
 * GET /api/sessions/current — resume an in-progress candidate session.
 *
 * Reads the httpOnly session cookie, looks up the response, and returns the
 * next question + running score. If the cookie is missing, the response is
 * already submitted, or the row vanished, returns null (200) so the client
 * can route the candidate back to the intake page (PRD §9 risk mitigation:
 * "candidate loses progress on refresh").
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { assessments, responses } from "@/lib/db/schema";
import {
  getNextQuestion,
  finalizeResponse,
} from "@/lib/assessment/engine";
import {
  getCandidateQuestion,
  getRunningScore,
} from "@/lib/assessment/queries";
import type { CurrentSessionResponse } from "@/lib/assessment/validators";
import {
  clearCandidateSession,
  getCandidateSession,
} from "@/lib/session";

export async function GET() {
  const responseId = await getCandidateSession();
  if (!responseId) {
    return NextResponse.json<CurrentSessionResponse>(null);
  }

  const [row] = await db
    .select({
      id: responses.id,
      status: responses.status,
      assessmentId: responses.assessmentId,
      slug: assessments.slug,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!row || row.status !== "in_progress") {
    // Cookie points to a finalised or missing response — clear it.
    await clearCandidateSession();
    return NextResponse.json<CurrentSessionResponse>(null);
  }

  const next = await getNextQuestion(responseId);

  // If the engine reports we've reached the end (e.g. a `skip_to_end` rule
  // fired on the last answer but the response wasn't finalised yet), close
  // the session out now so the candidate doesn't see a half-state.
  if (next.kind === "end") {
    await finalizeResponse(responseId);
    await clearCandidateSession();
    return NextResponse.json<CurrentSessionResponse>(null);
  }

  const [question, score] = await Promise.all([
    getCandidateQuestion(next.questionId),
    getRunningScore(responseId),
  ]);

  const payload: CurrentSessionResponse = {
    response_id: row.id,
    assessment_slug: row.slug,
    next_question: question,
    score_so_far: score,
    is_complete: false,
  };
  return NextResponse.json(payload);
}
