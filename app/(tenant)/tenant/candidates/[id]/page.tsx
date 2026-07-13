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

  // Integrity findings — translated, sanitised. Metadata field names
  // match responses.metadata (tab_blur_count, paste_count, session_loads,
  // start/submit IP hashes) — not the older *_events names the type
  // system doesn't enforce.
  const rawMeta = (row.response.metadata ?? {}) as {
    tab_blur_count?: number;
    paste_count?: number;
    session_loads?: number;
    start_ip_hash?: string;
    submit_ip_hash?: string;
    ai_likelihood_score?: number;
    style_shift_score?: number;
    average_response_time_std_dev?: number;
    proctoring_flagged?: boolean;
  };
  const ipMatches = await loadIpMatchPartnersFor(id);
  const findings: IntegrityFinding[] = translateRawSignals({
    copyPasteEvents: rawMeta.paste_count ?? 0,
    tabSwitchEvents: rawMeta.tab_blur_count ?? 0,
    aiLikelihoodScore: rawMeta.ai_likelihood_score,
    styleShiftScore: rawMeta.style_shift_score,
    averageResponseTimeStdDev: rawMeta.average_response_time_std_dev,
    proctoringFlagged: rawMeta.proctoring_flagged,
  });
  if (
    rawMeta.start_ip_hash &&
    rawMeta.submit_ip_hash &&
    rawMeta.start_ip_hash !== rawMeta.submit_ip_hash
  ) {
    findings.unshift({
      text: "The candidate's network changed between starting and finishing the assessment. Could be a legitimate connection switch or someone else finishing on a different device.",
      severity: "warn",
      category: "same_device",
    });
  }
  if ((rawMeta.session_loads ?? 0) >= 4) {
    findings.unshift({
      text: `The candidate reloaded the assessment page ${rawMeta.session_loads} times. Often a poor connection, occasionally a sign of stopping and coming back.`,
      severity: "info",
      category: "pacing_anomaly",
    });
  }
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
