/**
 * GET  /api/admin/responses/[id]/cross-check-plan
 *
 * Returns the work the client needs to drive through the cross-check
 * pipeline. The client picks each step from this plan and POSTs to
 * /api/admin/answers/[id]/cross-check-step.
 *
 * Response:
 *   {
 *     scorable: [{ answerId, maxPoints }],   // open answers with a rubric
 *                                             // and a transcript or text
 *     skipped:  string[],                    // human-readable reasons
 *     existing: { gemini: string[], kimi: string[] }  // answer ids already scored
 *   }
 *
 * POST /api/admin/responses/[id]/cross-check-plan
 *
 * Finalizes consensus once the client has scored what it intended to
 * score. Reads the persisted ai_scores rows, computes mean abs diff on
 * the answers where BOTH providers scored, applies the threshold, and
 * stamps ai_consensus + ai_pipeline_ran_at on the response.
 *
 * Body: { agree_threshold?: number = 1.0 }
 * Returns: { consensus, sample_size, sample_diff }
 *
 * Permission: editor or above AND can-run-AI-pipeline.
 */

import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import {
  canRunAiPipeline,
  loadAiScoringRoles,
} from "@/lib/auth/feature-flags";
import { db } from "@/lib/db/client";
import { aiScores, answers, questions, responses } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
    return NextResponse.json({ error: "ai_pipeline_disabled" }, { status: 403 });
  }
  const { id } = await params;

  const rows = await db
    .select({
      answerId: answers.id,
      transcript: answers.transcript,
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      questionType: questions.type,
      rubric: questions.scoringRubric,
      points: questions.points,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, id));

  const scorable: { answerId: string; maxPoints: number }[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    if (r.questionType !== "open") continue;
    if (!r.rubric || r.rubric.trim() === "") {
      skipped.push(`${r.answerId.slice(0, 8)} (no rubric)`);
      continue;
    }
    const txt = (r.transcript ?? "").trim() || (r.textResponse ?? "").trim();
    if (!txt) {
      skipped.push(
        `${r.answerId.slice(0, 8)} (${r.audioPath ? "needs transcript" : "no answer"})`,
      );
      continue;
    }
    scorable.push({ answerId: r.answerId, maxPoints: r.points });
  }

  const ids = scorable.map((s) => s.answerId);
  const existingRows = ids.length
    ? await db
        .select({ answerId: aiScores.answerId, provider: aiScores.provider })
        .from(aiScores)
        .where(inArray(aiScores.answerId, ids))
    : [];
  const existing = {
    gemini: existingRows.filter((r) => r.provider === "gemini").map((r) => r.answerId),
    kimi: existingRows.filter((r) => r.provider === "kimi").map((r) => r.answerId),
  };

  return NextResponse.json({ scorable, skipped, existing });
}

const finalizeSchema = z.object({
  agree_threshold: z.number().min(0).max(10).default(1.0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
    return NextResponse.json({ error: "ai_pipeline_disabled" }, { status: 403 });
  }
  const { id } = await params;

  const parsed = finalizeSchema.safeParse(await req.json().catch(() => ({})));
  const threshold = parsed.success ? parsed.data.agree_threshold : 1.0;

  const responseRow = await db
    .select({ id: responses.id })
    .from(responses)
    .where(eq(responses.id, id))
    .limit(1);
  if (responseRow.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Pull every ai_scores row for this response's answers.
  const answerIds = (
    await db
      .select({ id: answers.id })
      .from(answers)
      .where(eq(answers.responseId, id))
  ).map((a) => a.id);

  const aiRows = answerIds.length
    ? await db
        .select({
          answerId: aiScores.answerId,
          provider: aiScores.provider,
          score: aiScores.score,
        })
        .from(aiScores)
        .where(inArray(aiScores.answerId, answerIds))
    : [];

  const geminiByAnswer = new Map<string, number>();
  const kimiByAnswer = new Map<string, number>();
  for (const row of aiRows) {
    if (row.provider === "gemini") geminiByAnswer.set(row.answerId, row.score);
    if (row.provider === "kimi") kimiByAnswer.set(row.answerId, row.score);
  }

  let consensus: "gemini_only" | "agree" | "override" = "gemini_only";
  let sampleDiff: number | null = null;
  const overlap: number[] = [];
  for (const [aId, g] of geminiByAnswer) {
    const k = kimiByAnswer.get(aId);
    if (typeof k === "number") overlap.push(Math.abs(g - k));
  }
  if (overlap.length > 0) {
    sampleDiff = overlap.reduce((s, n) => s + n, 0) / overlap.length;
    // If Kimi scored EVERY answer Gemini did, it's a full rescore (override).
    // If Kimi only scored a subset, it's a sample — agree if within threshold.
    const fullRescore = kimiByAnswer.size === geminiByAnswer.size;
    if (fullRescore) {
      consensus = "override";
    } else {
      consensus = sampleDiff <= threshold ? "agree" : "override";
    }
  }

  await db
    .update(responses)
    .set({
      aiConsensus:
        geminiByAnswer.size === 0
          ? "pending"
          : consensus === "gemini_only"
            ? "gemini_only"
            : consensus,
      aiPipelineRanAt: new Date(),
    })
    .where(eq(responses.id, id));

  return NextResponse.json({
    consensus,
    gemini_scored: geminiByAnswer.size,
    kimi_scored: kimiByAnswer.size,
    sample_size: overlap.length,
    sample_diff: sampleDiff,
  });
}
