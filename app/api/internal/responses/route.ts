/**
 * GET /api/internal/responses?limit=300
 *
 * Every recent assessment submission on the platform, newest first: who sat
 * what, how they did, and whether it was a company's role assessment or a
 * validation session. For the ops console, where staff want one list of
 * submissions rather than the framework behind them.
 *
 * A summary, like the per-bank list: the reviewed detail lives here at
 * /admin/responses/<id>, and each row links to it.
 *
 * Auth: Bearer ETC_ASSESSMENT_SERVICE_TOKEN, like every /api/internal route.
 */
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { db } from "@/lib/db/client";
import { assessments, responses, tenantAssessmentBank, tenants } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.energytalentco.com").replace(/\/$/, "");
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "300");
  const limit = Number.isFinite(raw) ? Math.min(1000, Math.max(1, Math.floor(raw))) : 300;

  const rows = await db
    .select({
      id: responses.id,
      name: responses.candidateName,
      email: responses.candidateEmail,
      status: responses.status,
      totalScore: responses.totalScore,
      maxPossibleScore: responses.maxPossibleScore,
      pass: responses.pass,
      startedAt: responses.startedAt,
      submittedAt: responses.submittedAt,
      integrityDeductionPct: responses.integrityDeductionPct,
      assessmentId: assessments.id,
      assessmentTitle: assessments.title,
      roleType: assessments.roleType,
      specialisation: assessments.specialisation,
      passThreshold: assessments.passThreshold,
      bankId: tenantAssessmentBank.id,
      tenantName: tenants.name,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .leftJoin(tenantAssessmentBank, eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug))
    .leftJoin(tenants, eq(tenants.id, tenantAssessmentBank.tenantId))
    .orderBy(desc(responses.submittedAt), desc(responses.startedAt))
    .limit(limit);

  return NextResponse.json({
    count: rows.length,
    responses: rows.map((r) => {
      const pct =
        r.totalScore !== null && r.maxPossibleScore > 0
          ? Math.round((r.totalScore / r.maxPossibleScore) * 100)
          : null;
      return {
        response_id: r.id,
        name: r.name,
        email: r.email.toLowerCase(),
        status: r.status,
        total_score: r.totalScore,
        max_possible_score: r.maxPossibleScore,
        score_percent: pct,
        pass: r.pass,
        pass_threshold_percent: r.passThreshold,
        integrity_deduction_pct: r.integrityDeductionPct,
        started_at: r.startedAt?.toISOString() ?? null,
        submitted_at: r.submittedAt?.toISOString() ?? null,
        assessment_id: r.assessmentId,
        assessment_title: r.assessmentTitle,
        role_type: r.roleType,
        specialisation: r.specialisation,
        // A company's role assessment when a bank claims it; otherwise a
        // validation session from onboarding.
        kind: r.bankId ? "tenant" : "validation",
        tenant_name: r.tenantName,
        detail_url: `${siteBase()}/admin/responses/${r.id}`,
      };
    }),
  });
}
