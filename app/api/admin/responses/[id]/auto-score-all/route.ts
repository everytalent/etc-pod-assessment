/**
 * POST /api/admin/responses/[id]/auto-score-all
 *
 * The dual-AI cross-check pipeline:
 *
 *   1. Score every open-ended answer (with rubric + transcript or text)
 *      using Gemini. Persist as ai_scores row provider='gemini'.
 *   2. Pick a random sample of ~3 answers; rescore with Kimi. Persist as
 *      provider='kimi'.
 *   3. Compute mean absolute diff between Gemini and Kimi on the sample.
 *      Threshold default 1.0 (overridable via body).
 *      - diff ≤ threshold → response.ai_consensus='agree'
 *      - diff >  threshold → run Kimi on the remaining open-ended answers
 *        and mark response.ai_consensus='override'
 *   4. Stamp response.ai_pipeline_ran_at.
 *
 * Inputs:
 *   { sample_size?: number = 3, agree_threshold?: number = 1.0 }
 *
 * Returns:
 *   {
 *     consensus: 'agree' | 'override' | 'gemini_only',
 *     gemini_scored: number,
 *     kimi_scored: number,
 *     sample_diff: number | null,
 *     errors: string[],
 *   }
 *
 * Permission: editor or above.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { canRunAiPipeline } from "@/lib/auth/feature-flags";
import { scoreOpenEnded as geminiScore } from "@/lib/ai/gemini";
import { scoreOpenEndedKimi as kimiScore } from "@/lib/ai/kimi";
import { type ScoreSuggestion } from "@/lib/ai/scoring";
import { db } from "@/lib/db/client";
import {
  type AiScoreProvider,
  aiScores,
  answers,
  questions,
  responses,
} from "@/lib/db/schema";

const inputSchema = z.object({
  sample_size: z.number().int().min(1).max(10).default(3),
  agree_threshold: z.number().min(0).max(10).default(1.0),
});

type ScorableAnswer = {
  answerId: string;
  questionText: string;
  rubric: string;
  candidateAnswer: string;
  maxPoints: number;
};

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

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sample_size, agree_threshold } = parsed.data;

  const [response] = await db
    .select({ id: responses.id })
    .from(responses)
    .where(eq(responses.id, id))
    .limit(1);
  if (!response) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Pull every open-ended answer for this response that has a rubric AND
  // either a transcript or typed text. Questions without rubric or
  // without an answer to score against are skipped entirely.
  const answerRows = await db
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
    .where(eq(answers.responseId, id));

  const scorable: ScorableAnswer[] = [];
  const skipped: string[] = [];
  for (const r of answerRows) {
    if (r.questionType !== "open") continue;
    if (!r.rubric || r.rubric.trim() === "") {
      skipped.push(`${r.answerId.slice(0, 8)} (no rubric)`);
      continue;
    }
    const candidateAnswer =
      (r.transcript ?? "").trim() || (r.textResponse ?? "").trim();
    if (!candidateAnswer) {
      skipped.push(
        `${r.answerId.slice(0, 8)} (${r.audioPath ? "needs transcript" : "no answer"})`,
      );
      continue;
    }
    scorable.push({
      answerId: r.answerId,
      questionText: r.questionText,
      rubric: r.rubric,
      candidateAnswer,
      maxPoints: r.points,
    });
  }

  if (scorable.length === 0) {
    return NextResponse.json(
      {
        error: "nothing_to_score",
        message:
          "No open-ended answers in this response have both a rubric and a candidate answer ready.",
        skipped,
      },
      { status: 400 },
    );
  }

  const errors: string[] = [];

  // ---- 1. Gemini on every scorable answer ----
  const geminiResults = new Map<string, ScoreSuggestion>();
  for (const a of scorable) {
    try {
      const s = await geminiScore({
        questionText: a.questionText,
        rubric: a.rubric,
        candidateAnswer: a.candidateAnswer,
        maxPoints: a.maxPoints,
      });
      geminiResults.set(a.answerId, s);
      await persistAiScore(a.answerId, "gemini", s);
    } catch (err) {
      errors.push(
        `gemini ${a.answerId.slice(0, 8)}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }
  if (geminiResults.size === 0) {
    return NextResponse.json(
      {
        error: "gemini_failed",
        message: "Gemini scored none of the answers.",
        errors,
      },
      { status: 502 },
    );
  }

  // ---- 2. Kimi sample ----
  const sampled = pickRandom(
    scorable.filter((a) => geminiResults.has(a.answerId)),
    Math.min(sample_size, geminiResults.size),
  );
  const kimiResults = new Map<string, ScoreSuggestion>();
  for (const a of sampled) {
    try {
      const s = await kimiScore({
        questionText: a.questionText,
        rubric: a.rubric,
        candidateAnswer: a.candidateAnswer,
        maxPoints: a.maxPoints,
      });
      kimiResults.set(a.answerId, s);
      await persistAiScore(a.answerId, "kimi", s);
    } catch (err) {
      errors.push(
        `kimi ${a.answerId.slice(0, 8)}: ${err instanceof Error ? err.message : "failed"}`,
      );
    }
  }

  // ---- 3. Threshold check ----
  let sampleDiff: number | null = null;
  let consensus: "agree" | "override" | "gemini_only" = "gemini_only";
  if (kimiResults.size > 0) {
    const diffs: number[] = [];
    for (const [answerId, kimi] of kimiResults) {
      const gemini = geminiResults.get(answerId);
      if (gemini) diffs.push(Math.abs(gemini.suggestedScore - kimi.suggestedScore));
    }
    sampleDiff =
      diffs.length === 0
        ? null
        : diffs.reduce((a, b) => a + b, 0) / diffs.length;
    if (sampleDiff !== null) {
      consensus = sampleDiff <= agree_threshold ? "agree" : "override";
    }
  }

  // ---- 4. If override: Kimi on remaining ----
  if (consensus === "override") {
    const remaining = scorable.filter(
      (a) => geminiResults.has(a.answerId) && !kimiResults.has(a.answerId),
    );
    for (const a of remaining) {
      try {
        const s = await kimiScore({
          questionText: a.questionText,
          rubric: a.rubric,
          candidateAnswer: a.candidateAnswer,
          maxPoints: a.maxPoints,
        });
        kimiResults.set(a.answerId, s);
        await persistAiScore(a.answerId, "kimi", s);
      } catch (err) {
        errors.push(
          `kimi-rescore ${a.answerId.slice(0, 8)}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
    }
  }

  await db
    .update(responses)
    .set({ aiConsensus: consensus, aiPipelineRanAt: new Date() })
    .where(eq(responses.id, id));

  return NextResponse.json({
    consensus,
    gemini_scored: geminiResults.size,
    kimi_scored: kimiResults.size,
    sample_diff: sampleDiff,
    skipped,
    errors,
  });
}

async function persistAiScore(
  answerId: string,
  provider: AiScoreProvider,
  s: ScoreSuggestion,
) {
  // Drop any prior row for (answer, provider) and reinsert. Cleaner than
  // wrestling onConflictDoUpdate across providers/PKs and keeps the row
  // shape obviously the latest run.
  await db
    .delete(aiScores)
    .where(and(eq(aiScores.answerId, answerId), eq(aiScores.provider, provider)));
  await db.insert(aiScores).values({
    answerId,
    provider,
    score: s.suggestedScore,
    rationale: s.rationale,
    hits: s.hits,
    misses: s.misses,
    redFlags: s.redFlagsTriggered,
  });
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}
