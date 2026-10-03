/**
 * The AI cross-check, as functions.
 *
 * Scoring an answer with Gemini or Kimi, and settling the consensus for a
 * response, used to live only inside the admin route handlers, so the
 * only way to run them was a reviewer clicking "Run AI scoring". The
 * same work now runs on its own the moment a candidate submits (see
 * auto-score.ts), and the admin routes call these too, so there is one
 * implementation of what "scored" means.
 */

import { and, eq, inArray } from "drizzle-orm";

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import {
  scoreOpenEnded as geminiScore,
  transcribeAudio,
} from "@/lib/ai/gemini";
import { scoreOpenEndedKimi as kimiScore } from "@/lib/ai/kimi";
import type { ScoreSuggestion } from "@/lib/ai/scoring";
import { db } from "@/lib/db/client";
import {
  type AiScoreProvider,
  aiScores,
  answers,
  questions,
  responses,
} from "@/lib/db/schema";
import { getStorageAdmin, VOICE_BUCKET } from "@/lib/supabase/storage-admin";
import { isZohoArchived } from "@/lib/zoho/archive";

export class CrossCheckError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "not_scorable"
      | "audio_archived"
      | "download_failed"
      | "transcription_failed"
      | "no_text"
      | "ai_failed",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CrossCheckError";
  }
}

export type CrossCheckPlan = {
  scorable: { answerId: string; maxPoints: number; needsTranscription: boolean }[];
  skipped: string[];
  existing: { gemini: string[]; kimi: string[] };
};

/** Open answers with a rubric and something to read, and what is already scored. */
export async function planForResponse(responseId: string): Promise<CrossCheckPlan> {
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
    .where(eq(answers.responseId, responseId));

  const scorable: CrossCheckPlan["scorable"] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    if (r.questionType !== "open") continue;
    if (!r.rubric || r.rubric.trim() === "") {
      skipped.push(`${r.answerId.slice(0, 8)} (no rubric)`);
      continue;
    }
    const txt = (r.transcript ?? "").trim() || (r.textResponse ?? "").trim();
    if (txt) {
      scorable.push({ answerId: r.answerId, maxPoints: r.points, needsTranscription: false });
      continue;
    }
    if (r.audioPath) {
      scorable.push({ answerId: r.answerId, maxPoints: r.points, needsTranscription: true });
      continue;
    }
    skipped.push(`${r.answerId.slice(0, 8)} (no answer)`);
  }

  const ids = scorable.map((s) => s.answerId);
  const existingRows = ids.length
    ? await db
        .select({ answerId: aiScores.answerId, provider: aiScores.provider })
        .from(aiScores)
        .where(inArray(aiScores.answerId, ids))
    : [];
  return {
    scorable,
    skipped,
    existing: {
      gemini: existingRows.filter((r) => r.provider === "gemini").map((r) => r.answerId),
      kimi: existingRows.filter((r) => r.provider === "kimi").map((r) => r.answerId),
    },
  };
}

/**
 * Score one answer with one provider and persist it. Transcribes audio
 * first when there is no text yet. Throws CrossCheckError with the same
 * codes the admin route reports.
 */
export async function scoreAnswerWithProvider(
  answerId: string,
  provider: AiScoreProvider,
): Promise<{ answerId: string; provider: AiScoreProvider; suggestion: ScoreSuggestion }> {
  const [row] = await db
    .select({
      id: answers.id,
      responseId: answers.responseId,
      transcript: answers.transcript,
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      questionType: questions.type,
      questionText: questions.questionText,
      rubric: questions.scoringRubric,
      points: questions.points,
      integrityLevelSource: answers.integrityLevelSource,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.id, answerId))
    .limit(1);
  if (!row) throw new CrossCheckError("not_found", "Answer not found.", 404);
  if (row.questionType !== "open" || !row.rubric || !row.rubric.trim()) {
    throw new CrossCheckError("not_scorable", "Question must be open and have a rubric.", 400);
  }

  let candidateAnswer = (row.transcript ?? "").trim() || (row.textResponse ?? "").trim();
  if (!candidateAnswer && row.audioPath) {
    if (isZohoArchived(row.audioPath)) {
      throw new CrossCheckError("audio_archived", "Audio is archived to Zoho — transcribe before archiving next time.", 409);
    }
    let audio: ArrayBuffer;
    let mimeType: string;
    try {
      const supa = getStorageAdmin();
      const { data: blob, error: dlError } = await supa.storage.from(VOICE_BUCKET).download(row.audioPath);
      if (dlError || !blob) {
        throw new CrossCheckError("download_failed", dlError?.message ?? "Couldn't fetch audio from storage.", 502);
      }
      audio = await blob.arrayBuffer();
      mimeType = blob.type || "audio/webm";
    } catch (err) {
      if (err instanceof CrossCheckError) throw err;
      throw new CrossCheckError("download_failed", err instanceof Error ? err.message : "unknown", 502);
    }
    try {
      const transcript = await transcribeAudio({ audio, mimeType });
      await db.update(answers).set({ transcript }).where(eq(answers.id, answerId));
      candidateAnswer = transcript.trim();
    } catch (err) {
      throw new CrossCheckError("transcription_failed", err instanceof Error ? err.message : "unknown", 502);
    }
  }
  if (!candidateAnswer) {
    throw new CrossCheckError("no_text", "No transcript or text response yet — transcribe first.", 400);
  }

  let suggestion: ScoreSuggestion;
  try {
    const args = { questionText: row.questionText, rubric: row.rubric, candidateAnswer, maxPoints: row.points };
    suggestion = provider === "gemini" ? await geminiScore(args) : await kimiScore(args);
  } catch (err) {
    throw new CrossCheckError("ai_failed", err instanceof Error ? err.message : "unknown", 502);
  }

  await db.delete(aiScores).where(and(eq(aiScores.answerId, answerId), eq(aiScores.provider, provider)));
  await db.insert(aiScores).values({
    answerId,
    provider,
    score: suggestion.suggestedScore,
    rationale: suggestion.rationale,
    hits: suggestion.hits,
    misses: suggestion.misses,
    redFlags: suggestion.redFlagsTriggered,
    integrityProposal: suggestion.integrityProposal ?? null,
    integrityProposalRationale: suggestion.integrityProposalRationale ?? null,
  });

  // Kimi is the second assessor: its integrity proposal applies unless a
  // human has set the level (source 'manual'), which is never overwritten.
  if (
    provider === "kimi" &&
    suggestion.integrityProposal &&
    (row.integrityLevelSource === null || row.integrityLevelSource === "ai_kimi")
  ) {
    await db
      .update(answers)
      .set({
        integrityLevel: suggestion.integrityProposal,
        integrityLevelSource: "ai_kimi",
        integrityLevelSetBy: null,
        integrityLevelSetAt: new Date(),
      })
      .where(eq(answers.id, answerId));
    await recomputeResponseTotals(row.responseId);
  }

  return { answerId, provider, suggestion };
}

export type ConsensusResult = {
  consensus: "gemini_only" | "agree" | "override";
  gemini_scored: number;
  kimi_scored: number;
  sample_size: number;
  sample_diff: number | null;
};

/** Settle the consensus from the persisted scores and stamp the response. */
export async function finalizeConsensus(responseId: string, threshold = 1.0): Promise<ConsensusResult | null> {
  const [responseRow] = await db.select({ id: responses.id }).from(responses).where(eq(responses.id, responseId)).limit(1);
  if (!responseRow) return null;

  const answerIds = (await db.select({ id: answers.id }).from(answers).where(eq(answers.responseId, responseId))).map((a) => a.id);
  const aiRows = answerIds.length
    ? await db
        .select({ answerId: aiScores.answerId, provider: aiScores.provider, score: aiScores.score })
        .from(aiScores)
        .where(inArray(aiScores.answerId, answerIds))
    : [];

  const geminiByAnswer = new Map<string, number>();
  const kimiByAnswer = new Map<string, number>();
  for (const row of aiRows) {
    if (row.provider === "gemini") geminiByAnswer.set(row.answerId, row.score);
    if (row.provider === "kimi") kimiByAnswer.set(row.answerId, row.score);
  }

  let consensus: ConsensusResult["consensus"] = "gemini_only";
  let sampleDiff: number | null = null;
  const overlap: number[] = [];
  for (const [aId, g] of geminiByAnswer) {
    const k = kimiByAnswer.get(aId);
    if (typeof k === "number") overlap.push(Math.abs(g - k));
  }
  if (overlap.length > 0) {
    sampleDiff = overlap.reduce((s, n) => s + n, 0) / overlap.length;
    const fullRescore = kimiByAnswer.size === geminiByAnswer.size;
    consensus = fullRescore ? "override" : sampleDiff <= threshold ? "agree" : "override";
  }

  await db
    .update(responses)
    .set({
      aiConsensus: geminiByAnswer.size === 0 ? "pending" : consensus === "gemini_only" ? "gemini_only" : consensus,
      aiPipelineRanAt: new Date(),
    })
    .where(eq(responses.id, responseId));

  return {
    consensus,
    gemini_scored: geminiByAnswer.size,
    kimi_scored: kimiByAnswer.size,
    sample_size: overlap.length,
    sample_diff: sampleDiff,
  };
}
