/**
 * Response review — Server Component bootstrap, client table for sortable
 * columns + drill-in modal + selection-mode bulk-delete.
 *
 * Preview-tagged sessions (admins testing the candidate flow) are hidden
 * from this view by default. Use ?show_preview=1 to include them.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ResponseTable } from "@/components/admin/ResponseTable";
import { ZohoExportButton } from "@/components/admin/ZohoExportButton";
import { CAN, getAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, assessments, responses } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AssessmentResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show_preview?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) notFound();

  const { id } = await params;
  const { show_preview } = await searchParams;
  const includePreview = show_preview === "1";

  const [assessment] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) notFound();

  // Filter out preview-tagged responses unless explicitly requested.
  const previewFilter = includePreview
    ? undefined
    : sql`COALESCE((${responses.metadata} ->> 'preview')::boolean, false) = false`;

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
      isPreview: sql<boolean>`COALESCE((${responses.metadata} ->> 'preview')::boolean, false)`,
    })
    .from(responses)
    .where(
      previewFilter
        ? and(eq(responses.assessmentId, id), previewFilter)
        : eq(responses.assessmentId, id),
    )
    .orderBy(desc(responses.startedAt));

  const role = session.admin.role;
  const canDelete = CAN.deleteResponses(role);
  const canExport = CAN.exportResponses(role);

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
            {rows.length} {includePreview ? "total (incl. previews)" : "total"} ·
            pass threshold {assessment.passThreshold}%
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={
              includePreview
                ? `/admin/assessments/${assessment.id}/responses`
                : `/admin/assessments/${assessment.id}/responses?show_preview=1`
            }
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-3 text-xs hover:border-etc-marigold"
          >
            {includePreview ? "Hide previews" : "Show previews"}
          </Link>
          {canExport && (
            <>
              <a
                href={`/api/admin/assessments/${assessment.id}/responses/export`}
                className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
                download
              >
                Export CSV
              </a>
              <ZohoExportButton assessmentId={assessment.id} />
            </>
          )}
          <Link
            href={`/admin/assessments/${assessment.id}/edit`}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm hover:border-etc-marigold"
          >
            ← Edit assessment
          </Link>
        </div>
      </div>

      <div className="mt-8">
        <ResponseTable rows={rows} canDelete={canDelete} />
      </div>
    </main>
  );
}
