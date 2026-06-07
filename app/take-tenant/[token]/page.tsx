/**
 * /take-tenant/[token] — candidate landing for tenant-builder
 * assessments.
 *
 * Different shape from /take/[token]: the token is the
 * tenant_assessment_bank.assessment_link_token (the slug of the
 * underlying assessment row), shared by the tenant across many
 * candidates. Each candidate creates a fresh response on submit.
 *
 * Flow:
 *   1. Resolve token → tenant_assessment_bank → assessments row
 *   2. Render brand-themed welcome with intake-type aware framing
 *   3. Candidate enters name + email + accessibility flag, posts to
 *      /take-tenant/[token]/start which creates the response row
 *   4. Sample assessment runs first (separate page), then real runner
 */

import { and, eq, gte } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/lib/db/client";
import {
  assessments,
  tenantAssessmentBank,
  tenants,
} from "@/lib/db/schema";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import { getTenantBrand } from "@/lib/tenant/branding";

import { CandidateLandingForm } from "./CandidateLandingForm";

export const dynamic = "force-dynamic";

export default async function TenantTakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [row] = await db
    .select({
      bankId: tenantAssessmentBank.id,
      tenantId: tenantAssessmentBank.tenantId,
      tenantName: tenants.name,
      intakeType: tenantAssessmentBank.intakeType,
      assessmentId: assessments.id,
      assessmentTitle: assessments.title,
      linkExpiresAt: tenantAssessmentBank.linkExpiresAt,
      status: tenantAssessmentBank.status,
    })
    .from(tenantAssessmentBank)
    .innerJoin(tenants, eq(tenants.id, tenantAssessmentBank.tenantId))
    .innerJoin(assessments, eq(assessments.slug, tenantAssessmentBank.assessmentLinkToken))
    .where(
      and(
        eq(tenantAssessmentBank.assessmentLinkToken, token),
        eq(tenantAssessmentBank.status, "ready"),
        gte(tenantAssessmentBank.linkExpiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const brand = await getTenantBrand(row.tenantId);
  const intakeLabel =
    row.intakeType === "job_description" ? "role" : "project";

  return (
    <TenantThemeProvider brand={brand} className="block min-h-dvh bg-background">
      <main className="mx-auto max-w-xl px-6 py-12">
        <header className="text-center">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={row.tenantName}
              className="mx-auto h-10 w-auto"
            />
          ) : (
            <p className="text-sm font-semibold">{row.tenantName}</p>
          )}
          <h1 className="mt-4 text-2xl font-bold">Welcome.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            You&apos;re about to take a short assessment for the {intakeLabel}{" "}
            {row.tenantName} is hiring for. The algorithm adapts as you go.
            We&apos;ll walk you through a short practice round first.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-border bg-card p-5">
          <CandidateLandingForm token={token} />
        </section>

        <footer className="mt-10 text-center text-[0.65rem] text-muted-foreground">
          Powered by ETC
        </footer>
      </main>
    </TenantThemeProvider>
  );
}
