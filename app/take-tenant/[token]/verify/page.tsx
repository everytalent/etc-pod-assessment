/**
 * /take-tenant/[token]/verify — one-time-code gate between the practice
 * round and the real assessment. Confirms the candidate really controls
 * the email they typed in on the landing form.
 */

import { redirect } from "next/navigation";
import { and, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  tenantAssessmentBank,
  tenants,
} from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import { getTenantBrand } from "@/lib/tenant/branding";

import { VerifyClient } from "./VerifyClient";

export const dynamic = "force-dynamic";

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const responseId = await getCandidateSession();
  if (!responseId) redirect(`/take-tenant/${token}`);

  const [row] = await db
    .select({
      responseId: responses.id,
      candidateEmail: responses.candidateEmail,
      metadata: responses.metadata,
      tenantId: tenantAssessmentBank.tenantId,
      tenantName: tenants.name,
      assessmentSlug: assessments.slug,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .innerJoin(tenants, eq(tenants.id, tenantAssessmentBank.tenantId))
    .where(
      and(
        eq(responses.id, responseId),
        eq(tenantAssessmentBank.assessmentLinkToken, token),
        eq(tenantAssessmentBank.status, "ready"),
        gte(tenantAssessmentBank.linkExpiresAt, new Date()),
        isNull(tenantAssessmentBank.deletedAt),
      ),
    )
    .limit(1);

  if (!row) redirect(`/take-tenant/${token}`);

  // If already verified, skip straight through to the runner.
  const meta = (row.metadata ?? {}) as { identity_verified_at?: string };
  if (meta.identity_verified_at) {
    redirect(`/assess/${row.assessmentSlug}/session`);
  }

  const brand = await getTenantBrand(row.tenantId);
  const maskedEmail = maskEmail(row.candidateEmail);

  return (
    <TenantThemeProvider brand={brand} className="block min-h-dvh bg-background">
      <main className="mx-auto max-w-md px-6 py-12">
        <header className="text-center">
          <p className="text-sm font-semibold">{row.tenantName}</p>
          <h1 className="mt-2 text-xl font-bold">
            One more thing — confirm it&rsquo;s you
          </h1>
          <p className="mt-3 text-xs text-muted-foreground">
            We&rsquo;ll email a 6-digit code to{" "}
            <span className="font-semibold text-foreground">{maskedEmail}</span>
            . Enter it below and the real assessment starts.
          </p>
        </header>
        <VerifyClient
          token={token}
          assessmentSlug={row.assessmentSlug}
          maskedEmail={maskedEmail}
        />
        <footer className="mt-10 text-center text-[0.65rem] text-muted-foreground">
          Powered by ETC
        </footer>
      </main>
    </TenantThemeProvider>
  );
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return email;
  const head = user.slice(0, Math.min(2, user.length));
  const tail = user.length > 3 ? user.slice(-1) : "";
  return `${head}${"•".repeat(Math.max(2, user.length - head.length - tail.length))}${tail}@${domain}`;
}
