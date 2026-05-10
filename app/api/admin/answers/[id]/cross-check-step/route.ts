/**
 * POST /api/admin/answers/[id]/cross-check-step
 *
 * One unit of work in the cross-check pipeline: score a single answer
 * with a single provider (Gemini or Kimi) and persist the result. The
 * client calls this in a loop so we don't hit Netlify's 30 s function
 * timeout on long assessments — same shape as the audio archive batch
 * loop.
 *
 * Body: { provider: 'gemini' | 'kimi' }
 * Returns: { score, rationale, hits, misses, redFlagsTriggered }
 *
 * Permission: editor or above AND can-run-AI-pipeline.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { canRunAiPipeline } from "@/lib/auth/feature-flags";
import { scoreOpenEnded as geminiScore } from "@/lib/ai/gemini";
import { scoreOpenEndedKimi as kimiScore } from "@/lib/ai/kimi";
import type { ScoreSuggestion } from "@/lib/ai/scoring";
import { db } from "@/lib/db/client";
import {
  type AiScoreProvider,
  aiScores,
  answers,
  questions,
} from "@/lib/db/schema";

const inputSchema = z.object({
  provider: z.enum(["gemini", "kimi"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  if (!canRunAiPipeline(auth.session.admin.role)) {
    return NextResponse.json(
      {
        error: "ai_pipeline_disabled",
        message:
          "AI scoring isn't available for your role yet. Ask a super admin if you should have access.",
      },
      { status: 403 },
    );
  }
  const { id } = await params;

  const parsed = inputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const provider: AiScoreProvider = parsed.data.provider;

  const [row] = await db
    .select({
      id: answers.id,
      transcript: answers.transcript,
      textResponse: answers.textResponse,
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
  if (row.questionType !== "open" || !row.rubric || !row.rubric.trim()) {
    return NextResponse.json(
      { error: "not_scorable", message: "Question must be open and have a rubric." },
      { status: 400 },
    );
  }
  const candidateAnswer =
    (row.transcript ?? "").trim() || (row.textResponse ?? "").trim();
  if (!candidateAnswer) {
    return NextResponse.json(
      {
        error: "no_text",
        message: "No transcript or text response yet — transcribe first.",
      },
      { status: 400 },
    );
  }

  let suggestion: ScoreSuggestion;
  try {
    if (provider === "gemini") {
      suggestion = await geminiScore({
        questionText: row.questionText,
        rubric: row.rubric,
        candidateAnswer,
        maxPoints: row.points,
      });
    } else {
      suggestion = await kimiScore({
        questionText: row.questionText,
        rubric: row.rubric,
        candidateAnswer,
        maxPoints: row.points,
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "ai_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }

  // Upsert: drop any prior row for (answer, provider), then insert the
  // fresh result. Cleaner than wrestling onConflictDoUpdate.
  await db
    .delete(aiScores)
    .where(and(eq(aiScores.answerId, id), eq(aiScores.provider, provider)));
  await db.insert(aiScores).values({
    answerId: id,
    provider,
    score: suggestion.suggestedScore,
    rationale: suggestion.rationale,
    hits: suggestion.hits,
    misses: suggestion.misses,
    redFlags: suggestion.redFlagsTriggered,
  });

  return NextResponse.json({
    answerId: id,
    provider,
    suggestion,
  });
}
