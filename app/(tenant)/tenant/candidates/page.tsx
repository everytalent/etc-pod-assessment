/**
 * /tenant/candidates — list of every candidate response across this
 * tenant's assessment banks.
 */

import { desc, eq, sql } from "drizzle-orm";
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

  const rows = await db
    .select({
      responseId: responses.id,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      status: responses.status,
      submittedAt: responses.submittedAt,
      totalScore: responses.totalScore,
      maxPossibleScore: responses.maxPossibleScore,
      bankId: tenantAssessmentBank.id,
      intakeType: tenantAssessmentBank.intakeType,
      assessmentTitle: assessments.title,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .where(eq(tenantAssessmentBank.tenantId, session.tenant.id))
    .orderBy(desc(responses.submittedAt))
    .limit(200);

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Candidates</h1>
        <p className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No candidates yet. Send an assessment link to start collecting
          responses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Candidates</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length.toLocaleString()} response
          {rows.length === 1 ? "" : "s"}.
        </p>
      </header>

      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Candidate</th>
            <th className="py-2 pr-3 font-medium">Assessment</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium text-right">Score</th>
            <th className="py-2 pr-3 font-medium">Submitted</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.responseId}>
              <td className="py-2 pr-3">
                <div className="font-medium">{r.candidateName}</div>
                <div className="text-[0.65rem] text-muted-foreground">
                  {r.candidateEmail}
                </div>
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {r.assessmentTitle}
              </td>
              <td className="py-2 pr-3 font-mono text-[0.65rem]">
                {r.status}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.totalScore !== null
                  ? `${r.totalScore} / ${r.maxPossibleScore}`
                  : "—"}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                {r.submittedAt
                  ? new Date(r.submittedAt).toLocaleDateString()
                  : "—"}
              </td>
              <td className="py-2 text-right">
                <Link
                  href={`/tenant/candidates/${r.responseId}`}
                  className="text-foreground underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[0.6rem] text-muted-foreground">
        Showing newest {rows.length}. {void sql}
      </p>
    </div>
  );
}
