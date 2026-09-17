/**
 * GET /api/internal/tenant-banks/responses?bank_id=<uuid>
 *
 * Every candidate who has taken (or started) the assessment for one role,
 * with their result.
 *
 * Exists because the people deciding who to interview work in the matching
 * engine and JD Studio, not in here. Before this, an applicant's result lived
 * only on this platform, so "who passed" meant signing into a second product
 * and matching people up by eye against the applicant list in a third. The
 * summary belongs next to the applications.
 *
 * Deliberately a summary, not the whole submission. Per-question answers,
 * scoring rationale, override controls and integrity findings already have a
 * reviewed surface here at /tenant/candidates/<id>, and the row carries a link
 * to it. Re-rendering all of that somewhere else would duplicate a lot of
 * judgement and drift from it the first time either side changed.
 *
 * Auth: Bearer ETC_ASSESSMENT_SERVICE_TOKEN, like every /api/internal route.
 */

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { db } from "@/lib/db/client";
import { assessments, responses, tenantAssessmentBank } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function siteBase(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.energytalentco.com"
  ).replace(/\/$/, "");
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const bankId = new URL(req.url).searchParams.get("bank_id") ?? "";
  if (!z.string().uuid().safeParse(bankId).success) {
    return NextResponse.json({ error: "invalid_bank_id" }, { status: 400 });
  }

  // The bank's link token is the assessment's slug; that join is how a bank
  // finds the assessment its candidates actually sat.
  const [bank] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      assessmentId: assessments.id,
      assessmentTitle: assessments.title,
      passThreshold: assessments.passThreshold,
    })
    .from(tenantAssessmentBank)
    .innerJoin(
      assessments,
      eq(assessments.slug, tenantAssessmentBank.assessmentLinkToken),
    )
    .where(eq(tenantAssessmentBank.id, bankId))
    .limit(1);

  if (!bank) {
    // A bank that exists but has not finished generating has no assessment row
    // yet. That is not an error; it means nobody can have taken it.
    return NextResponse.json({
      bank_id: bankId,
      assessment_title: null,
      pass_threshold_percent: null,
      responses: [],
      note: "No assessment for this bank yet.",
    });
  }

  const rows = await db
    .select({
      id: responses.id,
      name: responses.candidateName,
      email: responses.candidateEmail,
      phone: responses.candidatePhone,
      status: responses.status,
      totalScore: responses.totalScore,
      maxPossibleScore: responses.maxPossibleScore,
      pass: responses.pass,
      startedAt: responses.startedAt,
      submittedAt: responses.submittedAt,
      aiConsensus: responses.aiConsensus,
      integrityDeductionPct: responses.integrityDeductionPct,
    })
    .from(responses)
    .where(and(eq(responses.assessmentId, bank.assessmentId)))
    .orderBy(desc(responses.submittedAt), desc(responses.startedAt))
    .limit(500);

  return NextResponse.json({
    bank_id: bank.id,
    assessment_title: bank.assessmentTitle,
    pass_threshold_percent: bank.passThreshold,
    responses: rows.map((r) => {
      // Percentage is computed here rather than left to each caller, so
      // "62%" means the same thing everywhere it is shown.
      const pct =
        r.totalScore !== null && r.maxPossibleScore > 0
          ? Math.round((r.totalScore / r.maxPossibleScore) * 100)
          : null;
      return {
        response_id: r.id,
        name: r.name,
        email: r.email.toLowerCase(),
        phone: r.phone,
        status: r.status,
        total_score: r.totalScore,
        max_possible_score: r.maxPossibleScore,
        score_percent: pct,
        /**
         * Null until the response is scored. A null here means "not decided
         * yet", never "failed": showing an unfinished candidate as a fail is
         * the one mistake this list must not make.
         */
        pass: r.pass,
        started_at: r.startedAt?.toISOString() ?? null,
        submitted_at: r.submittedAt?.toISOString() ?? null,
        ai_consensus: r.aiConsensus,
        /** Set when the scoring pipeline docked marks for integrity signals. */
        integrity_deduction_pct: r.integrityDeductionPct,
        /** The full submission: per-question answers, rationale, overrides. */
        detail_url: `${siteBase()}/tenant/candidates/${r.id}`,
      };
    }),
  });
}
