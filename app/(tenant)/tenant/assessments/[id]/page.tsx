/**
 * Assessment result page (PRD §4).
 *
 * Shown once status='ready'. Surfaces the assessment link, copy action,
 * and a sample preview placeholder (Phase 2b wires the real stratified
 * sample). Brand-themed via <TenantThemeProvider />.
 *
 * If the bank isn't ready yet, redirect back to the waiting page.
 */

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";
import { getTenantBrand } from "@/lib/tenant/branding";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";

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
