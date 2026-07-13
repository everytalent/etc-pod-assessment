/**
 * /tenant/candidates/[id] — single candidate detail view.
 *
 * Surfaces the engine's full result + the per-question submission view
 * with override buttons. Brand-themed via the layout (which already
 * wraps everything in TenantThemeProvider for completed-onboarding
 * tenants).
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  answers,
  assessments,
  candidateResponseOverride,
  questions,
  responses,
  tenantAssessmentBank,
} from "@/lib/db/schema";
import {
  loadIpMatchPartnersFor,
  translateRawSignals,
  type IntegrityFinding,
} from "@/lib/tenant/integrity-findings";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

import { CandidateDetailClient } from "./CandidateDetailClient";

export const dynamic = "force-dynamic";

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");
  const { id } = await params;

  const [row] = await db
    .select({
      response: responses,
      assessmentTitle: assessments.title,
      bankId: tenantAssessmentBank.id,
      tenantId: tenantAssessmentBank.tenantId,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .where(eq(responses.id, id))
    .limit(1);

  if (!row) notFound();
  if (row.tenantId !== session.tenant.id) {
    notFound();
  }

  // Per-question submissions.
  const submission = await db
    .select({
      answerId: answers.id,
      questionId: questions.id,
      questionText: questions.questionText,
      questionType: questions.type,
      textResponse: answers.textResponse,
      transcript: answers.transcript,
      scoreAwarded: answers.scoreAwarded,
      scoreRationale: answers.scoreRationale,
      points: questions.points,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(eq(answers.responseId, id))
    .orderBy(asc(questions.orderIndex));

  // Overrides per question — latest wins.
  const overrides = await db
    .select()
    .from(candidateResponseOverride)
    .where(
      and(
        eq(candidateResponseOverride.responseId, id),
        eq(candidateResponseOverride.tenantId, session.tenant.id),
      ),
    )
    .orderBy(desc(candidateResponseOverride.createdAt));
  const overrideByQuestion = new Map<string, (typeof overrides)[number]>();
  for (const o of overrides) {
    if (!overrideByQuestion.has(o.questionId) && !o.revertedAt) {
      overrideByQuestion.set(o.questionId, o);
    }
  }

  // Integrity findings — translated, sanitised.
  const ipMatches = await loadIpMatchPartnersFor(id);
  const findings: IntegrityFinding[] = translateRawSignals({
    copyPasteEvents: (row.response.metadata as { copy_paste_events?: number })?.copy_paste_events ?? 0,
    tabSwitchEvents: (row.response.metadata as { tab_switch_events?: number })?.tab_switch_events ?? 0,
  });
  if (ipMatches.length > 0) {
    findings.unshift({
      text: `This candidate completed the assessment from the same device as ${ipMatches.length} other candidate(s) on this assessment. One person may have completed multiple submissions.`,
      severity: "warn",
      category: "same_device",
    });
  }

  // The serialiser is the chokepoint — strips internals + rebrands.
  const timeSpentSeconds =
    row.response.startedAt && row.response.submittedAt
      ? Math.max(
          0,
          Math.round(
            (row.response.submittedAt.getTime() -
              row.response.startedAt.getTime()) /
              1000,
          ),
        )
      : null;

  const serialised = serialiseForTenant({
    response_id: row.response.id,
    candidate_name: row.response.candidateName,
    candidate_email: row.response.candidateEmail,
    assessment_title: row.assessmentTitle,
    status: row.response.status,
    decision: row.response.pass === null ? "borderline" : row.response.pass ? "hire" : "not_hire",
    total_score: row.response.totalScore,
    max_possible_score: row.response.maxPossibleScore,
    submitted_at: row.response.submittedAt?.toISOString() ?? null,
    time_spent_seconds: timeSpentSeconds,
    integrity_findings: findings,
    submission: submission.map((s) => ({
      answer_id: s.answerId,
      question_id: s.questionId,
      question_text: s.questionText,
      question_type: s.questionType,
      candidate_answer_text: s.textResponse ?? s.transcript,
      ai_auto_score: s.scoreAwarded,
      final_score: s.scoreAwarded,
      points_awarded: s.scoreAwarded,
      ai_rationale: s.scoreRationale,
      override: overrideByQuestion.has(s.questionId)
        ? {
            new_score: overrideByQuestion.get(s.questionId)!.newScore,
            reason_category: overrideByQuestion.get(s.questionId)!
              .reasonCategory,
            reason_text: overrideByQuestion.get(s.questionId)!.reasonText,
          }
        : null,
    })),
  });

  return <CandidateDetailClient initial={serialised} />;
}
