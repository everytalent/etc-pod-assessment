/**
 * Tenant home — the workspace landing surface.
 *
 * Two priorities here:
 *   1. Make "Create an assessment" the most obvious thing on the page.
 *   2. Show the tenant what they've already created so they can return
 *      to a draft / waiting / completed assessment without hunting.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";
import { getTenantBrand } from "@/lib/tenant/branding";
import { DeleteBankButton } from "@/components/tenant/DeleteBankButton";
import { FailedBankActions } from "@/components/tenant/FailedBankActions";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import { OnboardingModal } from "@/components/tenant/OnboardingModal";

export const dynamic = "force-dynamic";

export default async function TenantHomePage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const brand = await getTenantBrand(session.tenant.id);
  const showOnboarding = !brand.onboardingCompletedAt;

  const recentBanks = await db
    .select({
      id: tenantAssessmentBank.id,
      intakeType: tenantAssessmentBank.intakeType,
      intakeText: tenantAssessmentBank.intakeText,
      status: tenantAssessmentBank.status,
      createdAt: tenantAssessmentBank.createdAt,
      assessmentLinkToken: tenantAssessmentBank.assessmentLinkToken,
    })
    .from(tenantAssessmentBank)
    .where(
      and(
        eq(tenantAssessmentBank.tenantId, session.tenant.id),
        isNull(tenantAssessmentBank.deletedAt),
      ),
    )
    .orderBy(desc(tenantAssessmentBank.createdAt))
    .limit(5);

  return (
    <TenantThemeProvider brand={brand} className="contents">
      <TenantHomeInner
        tenantName={session.tenant.name}
        countryCode={session.tenant.countryCode}
        currencyCode={session.tenant.currencyCode}
        pricingTier={session.tenant.pricingTier}
        recentBanks={recentBanks}
        onboardingComplete={Boolean(brand.onboardingCompletedAt)}
      />
      {showOnboarding && (
        <OnboardingModal
          tenantName={session.tenant.name}
          initialPrimary={brand.primaryColor}
          initialAccent={brand.accentColor}
          initialLogoUrl={brand.logoUrl}
        />
      )}
    </TenantThemeProvider>
  );
}

type BankRow = {
  id: string;
  intakeType: "job_description" | "scope_of_work";
  intakeText: string;
  status: string;
  createdAt: Date;
  assessmentLinkToken: string | null;
};

function TenantHomeInner({
  tenantName,
  countryCode,
  currencyCode,
  pricingTier,
  recentBanks,
  onboardingComplete,
}: {
  tenantName: string;
  countryCode: string;
  currencyCode: string;
  pricingTier: string;
  recentBanks: BankRow[];
  onboardingComplete: boolean;
}) {
  const createHref = onboardingComplete
    ? "/tenant/assessments/new"
    : "/tenant/assessments/onboarding";

  return (
    <section className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Welcome, {tenantName}.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Build assessments, send links to candidates, and review their results.
        </p>
      </header>

      <Link
        href={createHref}
        className="group block rounded-2xl border-2 border-foreground bg-foreground p-6 text-background transition-transform hover:-translate-y-0.5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-70">
              Start here
            </p>
            <h2 className="mt-2 text-xl font-bold">Create an assessment</h2>
            <p className="mt-2 max-w-md text-sm opacity-80">
              Paste a job description or a project brief. The algorithm builds
              the assessment, you send the link, candidates take it.
            </p>
          </div>
          <span className="rounded-full bg-background/15 px-4 py-2 text-sm font-semibold transition-colors group-hover:bg-background/25">
            New assessment →
          </span>
        </div>
      </Link>

      <section className="rounded-2xl border border-border bg-card">
        <header className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-sm font-semibold">Your assessments</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {recentBanks.length === 0
                ? "Nothing here yet."
                : `Showing your ${recentBanks.length} most recent.`}
            </p>
          </div>
          {recentBanks.length > 0 && (
            <Link
              href="/tenant/assessments"
              className="text-xs font-medium underline-offset-4 hover:underline"
            >
              See all
            </Link>
          )}
        </header>

        {recentBanks.length === 0 ? (
          <div className="p-5 text-xs text-muted-foreground">
            Once you create your first assessment, it shows up here with its
            status and a link to share with candidates.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {recentBanks.map((bank) => (
              <li key={bank.id}>
                <BankRowLink bank={bank} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Candidates
          </h3>
          <p className="mt-3 text-sm">
            See every candidate who has taken one of your assessments.
          </p>
          <Link
            href="/tenant/candidates"
            className="mt-4 inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-etc-marigold"
          >
            Open candidates
          </Link>
        </article>

        <article className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Billing
          </h3>
          <p className="mt-3 text-sm">
            Top up generation credits and candidate slots, view your ledger.
          </p>
          <Link
            href="/tenant/billing"
            className="mt-4 inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-etc-marigold"
          >
            Open billing
          </Link>
        </article>

        <article className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Workspace
          </h3>
          <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <dt>Country</dt>
              <dd className="text-foreground">{countryCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Currency</dt>
              <dd className="text-foreground">{currencyCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Tier</dt>
              <dd className="text-foreground">{pricingTier}</dd>
            </div>
          </dl>
          <Link
            href="/tenant/settings/branding"
            className="mt-4 inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-etc-marigold"
          >
            Update branding
          </Link>
        </article>
      </section>
    </section>
  );
}

function BankRowLink({ bank }: { bank: BankRow }) {
  const href = bankHref(bank);
  return (
    <div className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-muted/40">
      <Link href={href} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{intakeSnippet(bank.intakeText)}</p>
        <p className="mt-1 text-[0.7rem] text-muted-foreground">
          {intakeTypeLabel(bank.intakeType)} ·{" "}
          {formatTimestamp(bank.createdAt)}
        </p>
      </Link>
      <div className="flex shrink-0 items-center gap-3">
        <StatusPill status={bank.status} />
        {bank.status === "failed" && <FailedBankActions bankId={bank.id} />}
        <DeleteBankButton bankId={bank.id} />
      </div>
    </div>
  );
}

function bankHref(bank: BankRow): string {
  if (bank.status === "ready") return `/tenant/assessments/${bank.id}`;
  if (bank.status === "failed") return `/tenant/assessments/${bank.id}/waiting`;
  return `/tenant/assessments/${bank.id}/waiting`;
}

function intakeSnippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
}

function intakeTypeLabel(type: BankRow["intakeType"]): string {
  return type === "job_description" ? "Permanent role" : "Project brief";
}

function formatTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function StatusPill({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status;
  const tone = STATUS_TONES[status] ?? "muted";
  const className =
    tone === "success"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "danger"
        ? "bg-destructive/15 text-destructive"
        : tone === "active"
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  );
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  analysing: "Reading",
  calibrating: "Calibrating",
  crafting: "Crafting",
  finalising: "Finalising",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_TONES: Record<string, "active" | "success" | "danger" | "muted"> = {
  queued: "active",
  analysing: "active",
  calibrating: "active",
  crafting: "active",
  finalising: "active",
  ready: "success",
  failed: "danger",
};
