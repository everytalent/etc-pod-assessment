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

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import { requireEditorApi } from "@/lib/auth/admin";
import {
  canRunAiPipeline,
  loadAiScoringRoles,
} from "@/lib/auth/feature-flags";
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
} from "@/lib/db/schema";
import {
  getStorageAdmin,
  VOICE_BUCKET,
} from "@/lib/supabase/storage-admin";
import { isZohoArchived } from "@/lib/zoho/archive";

const inputSchema = z.object({
  provider: z.enum(["gemini", "kimi"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const allowed = await loadAiScoringRoles();
  if (!canRunAiPipeline(auth.session.admin.role, allowed)) {
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
  let candidateAnswer =
    (row.transcript ?? "").trim() || (row.textResponse ?? "").trim();
  // Auto-transcribe if the candidate left audio but no transcript yet. The
  // pipeline used to reject these with "needs transcript" and force the
  // admin to click Transcribe per-answer — we transparently fill it in so
  // a single Run AI scoring covers voice answers too. Archived audio
  // (path starts with 'zoho:') can't be recovered, so we surface the
  // friendlier message.
  if (!candidateAnswer && row.audioPath) {
    if (isZohoArchived(row.audioPath)) {
      return NextResponse.json(
        {
          error: "audio_archived",
          message:
            "Audio is archived to Zoho — transcribe before archiving next time.",
        },
        { status: 409 },
      );
    }
    try {
      const supa = getStorageAdmin();
      const { data: blob, error: dlError } = await supa.storage
        .from(VOICE_BUCKET)
        .download(row.audioPath);
      if (dlError || !blob) {
        return NextResponse.json(
          {
            error: "download_failed",
            message: dlError?.message ?? "Couldn't fetch audio from storage.",
          },
          { status: 502 },
        );
      }
      const audio = await blob.arrayBuffer();
      const mimeType = blob.type || "audio/webm";
      const transcript = await transcribeAudio({ audio, mimeType });
      await db
        .update(answers)
        .set({ transcript })
        .where(eq(answers.id, id));
      candidateAnswer = transcript.trim();
    } catch (err) {
      return NextResponse.json(
        {
          error: "transcription_failed",
          message: err instanceof Error ? err.message : "unknown",
        },
        { status: 502 },
      );
    }
  }
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
    integrityProposal: suggestion.integrityProposal ?? null,
    integrityProposalRationale: suggestion.integrityProposalRationale ?? null,
  });

  // Kimi is "second assessor" — if it proposes an integrity level and no
  // human has set one (the source is null or already ai_kimi from an
  // earlier run), apply the proposal to the answer with source=ai_kimi.
  // Human overrides flip the source to 'manual' (see /integrity), which
  // we never overwrite from here.
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
      .where(eq(answers.id, id));
    // Total may have changed if mid/high was just applied; recompute.
    await recomputeResponseTotals(row.responseId);
  }

  return NextResponse.json({
    answerId: id,
    provider,
    suggestion,
  });
}
