/**
 * Conversational session — Server Component.
 *
 * Reads the candidate session cookie, validates the response is in_progress
 * for THIS slug, asks the engine for the next question, and hands a fully
 * hydrated initial state to the ChatShell client component (PRD §9: "resume
 * from responses row keyed by session cookie" — done in one server pass).
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { ChatShell } from "@/components/candidate/ChatShell";
import {
  finalizeResponse,
  getNextQuestion,
} from "@/lib/assessment/engine";
import {
  getAnsweredHistory,
  getCandidateQuestion,
  getRunningScore,
} from "@/lib/assessment/queries";
import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AssessSessionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const responseId = await getCandidateSession();
  if (!responseId) redirect(`/assess/${slug}`);

  const [row] = await db
    .select({
      id: responses.id,
      status: responses.status,
      assessmentId: responses.assessmentId,
      assessmentSlug: assessments.slug,
      metadata: responses.metadata,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!row || row.assessmentSlug !== slug) {
    redirect(`/assess/${slug}`);
  }
  if (row.status !== "in_progress") {
    redirect(`/assess/${slug}/done`);
  }

  // Increment session_loads on every render. First load → 1; each
  // refresh / back-nav adds 1. Soft signal only — never blocks the
  // candidate; admins see it in the drill-in for context (poor
  // internet vs. potential cheating). Best-effort: if the write
  // fails we still serve the page.
  try {
    const meta = (row.metadata ?? {}) as ResponseMetadata;
    const next = (meta.session_loads ?? 0) + 1;
    await db
      .update(responses)
      .set({ metadata: { ...meta, session_loads: next } })
      .where(eq(responses.id, responseId));
  } catch {
    // Swallow — counter is observability, not load-bearing.
  }

  const next = await getNextQuestion(responseId);
  if (next.kind === "end") {
    await finalizeResponse(responseId);
    redirect(`/assess/${slug}/done`);
  }

  const [question, score, totalRows, history] = await Promise.all([
    getCandidateQuestion(next.questionId),
    getRunningScore(responseId),
    db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.assessmentId, row.assessmentId)),
    getAnsweredHistory(responseId),
  ]);

  return (
    <ChatShell
      initial={{
        responseId: row.id,
        slug,
        question,
        score,
        totalQuestions: totalRows.length,
        history,
      }}
    />
  );
}
