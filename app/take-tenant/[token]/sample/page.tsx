/**
 * Sample assessment runner — 1-2 generic practice questions before the
 * real assessment (PRD §4a). No scoring, retry permitted, skip allowed.
 *
 * Pulls the questions tagged sample=true + sample_for_bank_id matching
 * this bank. When the candidate finishes the sample (or skips), we
 * forward them to the existing question runner via /assess/<slug>/session.
 */

import { and, asc, eq, gte } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  tenantAssessmentBank,
  tenants,
} from "@/lib/db/schema";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import { getTenantBrand } from "@/lib/tenant/branding";

import { SampleRunner } from "./SampleRunner";

export const dynamic = "force-dynamic";

export default async function SamplePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ response?: string }>;
}) {
  const { token } = await params;
  const { response: responseId } = await searchParams;

  const [bank] = await db
    .select({
      bankId: tenantAssessmentBank.id,
      tenantId: tenantAssessmentBank.tenantId,
      tenantName: tenants.name,
      assessmentSlug: assessments.slug,
    })
    .from(tenantAssessmentBank)
    .innerJoin(tenants, eq(tenants.id, tenantAssessmentBank.tenantId))
    .innerJoin(
      assessments,
      eq(assessments.slug, tenantAssessmentBank.assessmentLinkToken),
    )
    .where(
      and(
        eq(tenantAssessmentBank.assessmentLinkToken, token),
        eq(tenantAssessmentBank.status, "ready"),
        gte(tenantAssessmentBank.linkExpiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!bank) notFound();
  if (!responseId) redirect(`/take-tenant/${token}`);

  const sampleQs = await db
    .select({
      id: questions.id,
      type: questions.type,
      questionText: questions.questionText,
      options: questions.options,
    })
    .from(questions)
    .where(
      and(
        eq(questions.sampleForBankId, bank.bankId),
        eq(questions.sample, true),
      ),
    )
    .orderBy(asc(questions.orderIndex));

  const brand = await getTenantBrand(bank.tenantId);

  return (
    <TenantThemeProvider brand={brand} className="block min-h-dvh bg-background">
      <main className="mx-auto max-w-xl px-6 py-10">
        <header className="text-center">
          <p className="text-sm font-semibold">{bank.tenantName}</p>
          <h1 className="mt-2 text-xl font-bold">Practice round</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            These don&apos;t count. They&apos;re here so you can get used to
            the question types before the real assessment starts.
          </p>
        </header>
        <SampleRunner
          token={token}
          assessmentSlug={bank.assessmentSlug}
          questions={sampleQs.map((q) => ({
            id: q.id,
            type: q.type,
            text: q.questionText,
            options: Array.isArray(q.options) ? q.options : [],
          }))}
        />
        <footer className="mt-10 text-center text-[0.65rem] text-muted-foreground">
          Powered by ETC
        </footer>
      </main>
    </TenantThemeProvider>
  );
}
