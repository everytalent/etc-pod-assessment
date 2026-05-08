/**
 * Response review — Server Component bootstrap, client table for sortable
 * columns + drill-in modal. PRD §7 acceptance: 100 rows render < 500ms.
 */

import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ResponseTable } from "@/components/admin/ResponseTable";
import { db } from "@/lib/db/client";
import { answers, assessments, responses } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AssessmentResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [assessment] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) notFound();

  const rows = await db
    .select({
      id: responses.id,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      status: responses.status,
      pass: responses.pass,
      totalScore: responses.totalScore,
      maxPossibleScore: responses.maxPossibleScore,
      startedAt: responses.startedAt,
      submittedAt: responses.submittedAt,
      timeOnTaskSeconds: sql<
        number | null
      >`COALESCE((${responses.metadata} ->> 'time_on_task_seconds')::int, NULL)`,
      answeredCount:
        sql<number>`(SELECT COUNT(*)::int FROM ${answers} WHERE ${answers.responseId} = ${responses.id})`,
    })
    .from(responses)
    .where(eq(responses.assessmentId, id))
    .orderBy(desc(responses.startedAt));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Responses
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {assessment.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} total · pass threshold {assessment.passThreshold}%
          </p>
        </div>
        <Link
          href={`/admin/assessments/${assessment.id}/edit`}
          className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm hover:border-etc-marigold"
        >
          ← Edit assessment
        </Link>
      </div>

      <div className="mt-8">
        <ResponseTable rows={rows} />
      </div>
    </main>
  );
}
