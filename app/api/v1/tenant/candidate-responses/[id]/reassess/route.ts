/**
 * POST /api/v1/tenant/candidate-responses/[id]/reassess
 * Body: { confirmed_recent_high_confidence?: boolean }
 *
 * Triggers a fresh response row for the candidate against the same
 * assessment, excluding the question IDs they've already seen. The
 * candidate gets a new email ("We'd like to learn more about your
 * skills") — never "retake" or "failed" language.
 *
 * PRD §6: 1 reassessment per candidate per role in v1. Confirmation
 * dialog required when original < 24h old AND confidence high — that
 * gate lives in the UI; this route just enforces the cap.
 */

import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  answers,
  assessments,
  candidateReassessment,
  responses,
  tenantAssessmentBank,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { consumeCandidateSlot } from "@/lib/tenant/billing/balance";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const schema = z.object({
  confirmed_recent_high_confidence: z.boolean().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id: originalResponseId } = await context.params;

  try {
    schema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
  }

  // Resolve the original response and confirm tenant scope.
  const [orig] = await db
    .select({
      response: responses,
      bankId: tenantAssessmentBank.id,
      tenantId: tenantAssessmentBank.tenantId,
      assessmentId: assessments.id,
      assessmentSlug: assessments.slug,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .where(eq(responses.id, originalResponseId))
    .limit(1);

  if (!orig) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (orig.tenantId !== auth.session.tenant.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Enforce 1-per-original cap.
  const [existing] = await db
    .select({ id: candidateReassessment.id })
    .from(candidateReassessment)
    .where(eq(candidateReassessment.originalResponseId, originalResponseId))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "reassessment_cap_reached" },
      { status: 409 },
    );
  }

  // Consume 1 candidate slot upfront (PRD §7 table).
  const slot = await consumeCandidateSlot({
    tenantId: auth.session.tenant.id,
    relatedCandidateAssessmentId: originalResponseId,
  });
  if (!slot.ok && slot.reason === "insufficient_balance") {
    return NextResponse.json(
      { error: "insufficient_slots" },
      { status: 402 },
    );
  }

  // Gather already-seen question IDs.
  const seenQs = await db
    .select({ questionId: answers.questionId })
    .from(answers)
    .where(eq(answers.responseId, originalResponseId));
  const excludedQuestionIds = seenQs.map((q) => q.questionId);

  // Mint the new response row.
  const meta = (orig.response.metadata ?? {}) as ResponseMetadata & {
    tenant_bank_id?: string;
    tenant_id?: string;
    accessibility_flag?: boolean;
    is_reassessment?: boolean;
  };
  const newMeta = {
    ...meta,
    is_reassessment: true,
    reassessment_of: originalResponseId,
    reassessment_excluded_question_ids: excludedQuestionIds,
  } as unknown as ResponseMetadata;

  const [newResp] = await db
    .insert(responses)
    .values({
      assessmentId: orig.assessmentId,
      candidateName: orig.response.candidateName,
      candidateEmail: orig.response.candidateEmail,
      candidatePhone: orig.response.candidatePhone,
      status: "in_progress",
      metadata: newMeta,
    })
    .returning({ id: responses.id });

  await db.insert(candidateReassessment).values({
    tenantAssessmentBankId: orig.bankId,
    originalResponseId,
    reassessmentResponseId: newResp.id,
    triggeredByUserId: auth.session.tenantUser.id,
    excludedQuestionIds,
  });

  // Email the candidate. notify() is non-blocking on misconfig.
  try {
    await notify({
      severity: "info",
      eventType: "tenant_reassessment_invited",
      payload: {
        tenant_id: auth.session.tenant.id,
        original_response_id: originalResponseId,
        reassessment_response_id: newResp.id,
        candidate_email: orig.response.candidateEmail,
        assessment_slug: orig.assessmentSlug,
        subject_hint: "We'd like to learn more about your skills",
      },
    });
  } catch {
    // Don't fail the reassess if notify is misconfigured.
  }

  void gt;
  return NextResponse.json(
    serialiseForTenant({
      ok: true,
      reassessment_response_id: newResp.id,
      excluded_question_count: excludedQuestionIds.length,
    }),
  );
  void and; // satisfy lint
}
