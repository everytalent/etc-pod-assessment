/**
 * GET /api/admin/responses/[id] — drill-in detail for one response.
 *
 * Returns the response, its answers (joined with the question text + options
 * + correct answer for review purposes), and the branching `path` from
 * metadata. Reviewers see correct_answer here — this is the admin track,
 * not the candidate UI.
 */

import { asc, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi, requireEditorApi } from "@/lib/auth/admin";
import {
  canRunAiPipeline,
  canSeeAiScores,
  loadAiScoringRoles,
} from "@/lib/auth/feature-flags";
import { db } from "@/lib/db/client";
import {
  type AiScore,
  type AiScoreProvider,
  adminUsers,
  aiScores,
  answers,
  questions,
  responses,
  scoreHistory,
} from "@/lib/db/schema";

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
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      audioDurationSeconds: answers.audioDurationSeconds,
      transcript: answers.transcript,
      scoredBy: answers.scoredBy,
      scoredAt: answers.scoredAt,
      timeSpentSeconds: answers.timeSpentSeconds,
      timedOut: answers.timedOut,
      scoreAwarded: answers.scoreAwarded,
      scoreSource: answers.scoreSource,
      scoreRationale: answers.scoreRationale,
      integrityLevel: answers.integrityLevel,
      integrityLevelSource: answers.integrityLevelSource,
      integrityLevelSetBy: answers.integrityLevelSetBy,
      integrityLevelSetAt: answers.integrityLevelSetAt,
      answeredAt: answers.answeredAt,
      questionText: questions.questionText,
      questionType: questions.type,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
      orderIndex: questions.orderIndex,
      points: questions.points,
      negativePoints: questions.negativePoints,
      section: questions.section,
      scoringRubric: questions.scoringRubric,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, id))
    .orderBy(asc(answers.answeredAt));

  // Pull persisted AI cross-check scores for this response's answers and
  // attach to each row keyed by provider. The drill-in renders side-by-side
  // when both providers have a row.
  const answerIds = answerRows.map((r) => r.answerId);
  const aiRows: AiScore[] = answerIds.length
    ? await db.select().from(aiScores).where(inArray(aiScores.answerId, answerIds))
    : [];
  const aiByAnswer = new Map<string, Partial<Record<AiScoreProvider, AiScore>>>();
  for (const row of aiRows) {
    const bucket = aiByAnswer.get(row.answerId) ?? {};
    bucket[row.provider] = row;
    aiByAnswer.set(row.answerId, bucket);
  }

  // Score history per answer — every prior score (most recent first).
  // Drives the "Prior scores" collapsible in the drill-in.
  const historyRows = answerIds.length
    ? await db
        .select({
          answerId: scoreHistory.answerId,
          scoreAwarded: scoreHistory.scoreAwarded,
          scoreSource: scoreHistory.scoreSource,
          scoreRationale: scoreHistory.scoreRationale,
          scoredBy: scoreHistory.scoredBy,
          scoredAt: scoreHistory.scoredAt,
          replacedAt: scoreHistory.replacedAt,
          replacedBy: scoreHistory.replacedBy,
        })
        .from(scoreHistory)
        .where(inArray(scoreHistory.answerId, answerIds))
        .orderBy(desc(scoreHistory.replacedAt))
    : [];
  const historyByAnswer = new Map<string, typeof historyRows>();
  for (const row of historyRows) {
    const bucket = historyByAnswer.get(row.answerId) ?? [];
    bucket.push(row);
    historyByAnswer.set(row.answerId, bucket);
  }

  // Attribute each scored answer to the person who saved it. Looking up
  // every scoredBy uuid in one round-trip and then mapping in memory.
  // Also includes anyone who replaced a score (history.replacedBy) and
  // anyone whose score appears in history (history.scoredBy) so the UI
  // can render attribution on prior-score rows too.
  const scorerIds = Array.from(
    new Set(
      [
        ...answerRows.map((r) => r.scoredBy),
        ...answerRows.map((r) => r.integrityLevelSetBy),
        ...historyRows.flatMap((h) => [h.scoredBy, h.replacedBy]),
      ].filter((v): v is string => Boolean(v)),
    ),
  );
  const scorerRows = scorerIds.length
    ? await db
        .select({
          id: adminUsers.id,
          email: adminUsers.email,
          role: adminUsers.role,
        })
        .from(adminUsers)
        .where(inArray(adminUsers.id, scorerIds))
    : [];
  const scorerById = new Map(scorerRows.map((s) => [s.id, s]));

  const role = auth.session.admin.role;
  const allowed = await loadAiScoringRoles();
  const enrichedAnswers = answerRows.map((r) => ({
    ...r,
    aiScores: aiByAnswer.get(r.answerId) ?? {},
    scorer: r.scoredBy ? (scorerById.get(r.scoredBy) ?? null) : null,
    integrityLevelSetByUser: r.integrityLevelSetBy
      ? (scorerById.get(r.integrityLevelSetBy) ?? null)
      : null,
    history: (historyByAnswer.get(r.answerId) ?? []).map((h) => ({
      ...h,
      scorer: h.scoredBy ? (scorerById.get(h.scoredBy) ?? null) : null,
      replacedByUser: h.replacedBy
        ? (scorerById.get(h.replacedBy) ?? null)
        : null,
    })),
    // Per-answer flag because assessors only see AI after their own score.
    canSeeAi: canSeeAiScores({
      role,
      hasOwnScore: Boolean(r.scoredAt),
      allowed,
    }),
  }));

  return NextResponse.json({
    response,
    answers: enrichedAnswers,
    viewer: {
      role,
      email: auth.session.email,
      canRunAiPipeline: canRunAiPipeline(role, allowed),
    },
  });
}

/**
 * DELETE /api/admin/responses/[id] — remove a candidate response.
 *
 * Cascades: the FK from answers.response_id → responses.id has ON DELETE
 * CASCADE, so all rows for this response disappear too.
 *
 * Permission: editor or above (per CAN.deleteResponses).
 *
 * NOTE: voice audio in Supabase Storage is NOT cleaned up here. That belongs
 * to the future archive/migration flow which already handles object cleanup.
 * Orphan audio would only matter if you re-create a response with the same
 * id (which is impossible since ids are uuid generated).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const removed = await db
    .delete(responses)
    .where(eq(responses.id, id))
    .returning({ id: responses.id });

  if (removed.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: removed[0]!.id });
}
