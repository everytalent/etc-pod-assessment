/**
 * Tenant assessments index — the full list of assessment banks the
 * tenant has created. The home dashboard shows the most recent five
 * inline; this surface shows everything with the same row shape.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { desc, eq } from "drizzle-orm";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";
import { getTenantBrand } from "@/lib/tenant/branding";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";

export const dynamic = "force-dynamic";

export default async function TenantAssessmentsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const brand = await getTenantBrand(session.tenant.id);
  if (!brand.onboardingCompletedAt) {
    redirect("/tenant/assessments/onboarding");
  }

  const banks = await db
    .select({
      id: tenantAssessmentBank.id,
      intakeType: tenantAssessmentBank.intakeType,
      intakeText: tenantAssessmentBank.intakeText,
      status: tenantAssessmentBank.status,
      createdAt: tenantAssessmentBank.createdAt,
      assessmentLinkToken: tenantAssessmentBank.assessmentLinkToken,
    })
    .from(tenantAssessmentBank)
    .where(eq(tenantAssessmentBank.tenantId, session.tenant.id))
    .orderBy(desc(tenantAssessmentBank.createdAt))
    .limit(100);

  return (
    <TenantThemeProvider brand={brand} className="contents">
      <section className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Assessments</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {banks.length === 0
                ? "You haven't created an assessment yet."
                : `${banks.length} assessment${banks.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          <Link
            href="/tenant/assessments/new"
            className="inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90"
          >
            + New assessment
          </Link>
        </header>

        {banks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
            Once you create your first assessment, every one you build will
            show up here.
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {banks.map((bank) => (
              <li key={bank.id}>
                <BankRow bank={bank} />
              </li>
            ))}
          </ul>
        )}
      </section>
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

function BankRow({ bank }: { bank: BankRow }) {
  return (
    <Link
      href={bankHref(bank)}
      className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{intakeSnippet(bank.intakeText)}</p>
        <p className="mt-1 text-[0.7rem] text-muted-foreground">
          {intakeTypeLabel(bank.intakeType)} ·{" "}
          {formatTimestamp(bank.createdAt)}
        </p>
      </div>
      <StatusPill status={bank.status} />
    </Link>
  );
}

function bankHref(bank: BankRow): string {
  if (bank.status === "ready") return `/tenant/assessments/${bank.id}`;
  return `/tenant/assessments/${bank.id}/waiting`;
}

function intakeSnippet(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
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
