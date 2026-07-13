/**
 * Assessment result page (PRD §4).
 *
 * Shown once status='ready'. Surfaces the assessment link, copy action,
 * and a sample preview placeholder (Phase 2b wires the real stratified
 * sample). Brand-themed via <TenantThemeProvider />.
 *
 * If the bank isn't ready yet, redirect back to the waiting page.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  tenantAssessmentBank,
} from "@/lib/db/schema";
import { getTenantBrand } from "@/lib/tenant/branding";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import {
  AssessmentCandidatesTable,
  type CandidateRow,
} from "@/components/tenant/AssessmentCandidatesTable";

export const dynamic = "force-dynamic";

export default async function AssessmentResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");
  const { id } = await params;

  const [row] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      intakeType: tenantAssessmentBank.intakeType,
      assessmentLinkToken: tenantAssessmentBank.assessmentLinkToken,
      linkExpiresAt: tenantAssessmentBank.linkExpiresAt,
      samplePreviewQuestionIds: tenantAssessmentBank.samplePreviewQuestionIds,
      createdAt: tenantAssessmentBank.createdAt,
    })
    .from(tenantAssessmentBank)
    .where(
      and(
        eq(tenantAssessmentBank.id, id),
        eq(tenantAssessmentBank.tenantId, session.tenant.id),
        isNull(tenantAssessmentBank.deletedAt),
      ),
    )
    .limit(1);

  if (!row) redirect("/tenant");
  if (row.status !== "ready") redirect(`/tenant/assessments/${id}/waiting`);

  const brand = await getTenantBrand(session.tenant.id);
  const link = row.assessmentLinkToken
    ? `https://assess.energytalentco.com/take-tenant/${row.assessmentLinkToken}`
    : null;

  const candidateRowsRaw = row.assessmentLinkToken
    ? await db
        .select({
          responseId: responses.id,
          candidateName: responses.candidateName,
          candidateEmail: responses.candidateEmail,
          status: responses.status,
          pass: responses.pass,
          totalScore: responses.totalScore,
          maxPossibleScore: responses.maxPossibleScore,
          submittedAt: responses.submittedAt,
          startedAt: responses.startedAt,
          metadata: responses.metadata,
        })
        .from(responses)
        .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
        .where(eq(assessments.slug, row.assessmentLinkToken))
        .orderBy(desc(responses.submittedAt))
    : [];

  const candidateRows: CandidateRow[] = candidateRowsRaw.map((r) => {
    const meta = (r.metadata ?? {}) as {
      tab_blur_count?: number;
      paste_count?: number;
      session_loads?: number;
      start_ip_hash?: string;
      submit_ip_hash?: string;
      ai_likelihood_score?: number;
      style_shift_score?: number;
      proctoring_flagged?: boolean;
    };
    const hasIntegrityIssue =
      (meta.tab_blur_count ?? 0) >= 3 ||
      (meta.paste_count ?? 0) >= 3 ||
      (meta.ai_likelihood_score ?? 0) > 0.7 ||
      (meta.style_shift_score ?? 0) > 0.6 ||
      Boolean(meta.proctoring_flagged) ||
      Boolean(
        meta.start_ip_hash &&
          meta.submit_ip_hash &&
          meta.start_ip_hash !== meta.submit_ip_hash,
      );
    return {
      responseId: r.responseId,
      candidateName: r.candidateName,
      candidateEmail: r.candidateEmail,
      status: r.status,
      decision:
        r.status !== "submitted"
          ? null
          : r.pass === true
            ? "hire"
            : r.pass === false
              ? "not_hire"
              : "borderline",
      totalScore: r.totalScore,
      maxPossibleScore: r.maxPossibleScore,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      hasIntegrityIssue,
    };
  });

  return (
    <TenantThemeProvider brand={brand} className="contents">
      <div className="space-y-6">
        <header>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {row.intakeType === "job_description" ? "Job description" : "Scope of work"}
          </p>
          <h1 className="mt-2 text-2xl font-bold">Your assessment is ready</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Built by ETC&apos;s Assessment Algorithm. Send the link to your
            candidates.
          </p>
        </header>

        {link ? (
          <section
            className="rounded-2xl border p-5"
            style={{ borderColor: "var(--tenant-primary, #f1b240)" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Assessment link
            </p>
            <div className="mt-2 flex items-center gap-3">
              <input
                readOnly
                value={link}
                aria-label="Assessment link"
                className="h-10 flex-1 rounded-lg border border-input bg-background px-3 font-mono text-xs"
              />
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-etc-marigold"
              >
                Open
              </a>
            </div>
            {row.linkExpiresAt && (
              <p className="mt-2 text-[0.65rem] text-muted-foreground">
                Expires {row.linkExpiresAt.toLocaleDateString()}.
              </p>
            )}
          </section>
        ) : null}

        <section className="space-y-3">
          <header className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Candidates</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Everyone who has been given this assessment.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {candidateRows.length} total
            </p>
          </header>
          {candidateRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-xs text-muted-foreground">
              No candidates have opened this assessment yet. Share the link
              above.
            </div>
          ) : (
            <AssessmentCandidatesTable rows={candidateRows} />
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Sample question preview</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Here&apos;s a taste of what the algorithm will draw from. Questions
            are adapted to each candidate&apos;s level as they progress, and
            the algorithm may generate similar new ones to probe deeper. The
            full bank stays sealed so candidates can&apos;t share answers.
          </p>
          {row.samplePreviewQuestionIds.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-[0.7rem] text-muted-foreground">
              Sample preview is generated alongside the bank in Phase 2b. The
              link above is fully usable; the preview surface lands shortly.
            </p>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              {row.samplePreviewQuestionIds.length} questions selected. Detail
              view follows in Phase 2b.
            </p>
          )}
        </section>

        <p className="text-center text-[0.65rem] text-muted-foreground">
          Built by ETC&apos;s Assessment Algorithm.
        </p>
      </div>
    </TenantThemeProvider>
  );
}
