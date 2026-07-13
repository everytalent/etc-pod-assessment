/**
 * /tenant/candidates — index of assessments with a headline count of
 * responses per assessment. Deep dive on any assessment surfaces the
 * full candidate table with filters at /tenant/assessments/[id].
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  tenantAssessmentBank,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function TenantCandidatesPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const groups = await db
    .select({
      bankId: tenantAssessmentBank.id,
      assessmentTitle: assessments.title,
      intakeType: tenantAssessmentBank.intakeType,
      createdAt: tenantAssessmentBank.createdAt,
      total: sql<number>`COUNT(${responses.id})::int`,
      submitted: sql<number>`SUM(CASE WHEN ${responses.status} = 'submitted' THEN 1 ELSE 0 END)::int`,
      hires: sql<number>`SUM(CASE WHEN ${responses.pass} = true THEN 1 ELSE 0 END)::int`,
      lastSubmittedAt: sql<Date | null>`MAX(${responses.submittedAt})`,
    })
    .from(tenantAssessmentBank)
    .innerJoin(assessments, eq(assessments.slug, tenantAssessmentBank.assessmentLinkToken))
    .leftJoin(responses, eq(responses.assessmentId, assessments.id))
    .where(
      and(
        eq(tenantAssessmentBank.tenantId, session.tenant.id),
        isNull(tenantAssessmentBank.deletedAt),
      ),
    )
    .groupBy(
      tenantAssessmentBank.id,
      assessments.title,
      tenantAssessmentBank.intakeType,
      tenantAssessmentBank.createdAt,
    )
    .orderBy(desc(tenantAssessmentBank.createdAt));

  const withCandidates = groups.filter((g) => g.total > 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Candidates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Grouped by assessment. Open one to see everyone who took it, with
          filters for decision, date, and integrity.
        </p>
      </header>

      {withCandidates.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No candidates yet. Send an assessment link to start collecting
          responses.
        </div>
      ) : (
        <ul className="space-y-3">
          {withCandidates.map((g) => (
            <li key={g.bankId}>
              <Link
                href={`/tenant/assessments/${g.bankId}`}
                className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-etc-marigold"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                      {g.intakeType === "job_description"
                        ? "Permanent role"
                        : "Project brief"}
                    </p>
                    <h2 className="mt-1 text-sm font-semibold text-foreground">
                      {g.assessmentTitle}
                    </h2>
                    <p className="mt-2 text-[0.7rem] text-muted-foreground">
                      Last submission{" "}
                      {g.lastSubmittedAt
                        ? formatRelative(g.lastSubmittedAt)
                        : "—"}
                    </p>
                  </div>
                  <dl className="flex shrink-0 gap-4 text-right">
                    <Stat label="Candidates" value={g.total} />
                    <Stat label="Submitted" value={g.submitted} />
                    <Stat label="Hires" value={g.hires} tone="success" />
                  </dl>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success";
}) {
  return (
    <div className="min-w-[3.5rem]">
      <p
        className={`text-base font-bold tabular-nums ${
          tone === "success" ? "text-emerald-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function formatRelative(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - dt.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(dt);
}
