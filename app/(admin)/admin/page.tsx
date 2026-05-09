/**
 * Admin dashboard — assessment list with status badges + metrics.
 *
 * Server-loaded directly from the DB (cheaper than round-tripping through
 * /api/admin/assessments since we're already on the server).
 */

import { count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";

import { AssessmentsTable } from "@/components/admin/AssessmentsTable";
import { db } from "@/lib/db/client";
import { assessments, responses } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const rows = await db
    .select({
      id: assessments.id,
      title: assessments.title,
      slug: assessments.slug,
      roleType: assessments.roleType,
      status: assessments.status,
      passThreshold: assessments.passThreshold,
      updatedAt: assessments.updatedAt,
      responseCount: count(responses.id),
      submittedCount:
        sql<number>`COUNT(CASE WHEN ${responses.status} = 'submitted' THEN 1 END)::int`,
      // Cast to float so Postgres returns a JS number (numeric → string by default).
      avgScore: sql<number | null>`AVG(${responses.totalScore})::float`,
    })
    .from(assessments)
    .leftJoin(responses, eq(responses.assessmentId, assessments.id))
    .groupBy(assessments.id)
    .orderBy(desc(assessments.updatedAt));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            ETC POD admin
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Assessments
          </h1>
        </div>
        <Link
          href="/admin/assessments/new"
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          New assessment
        </Link>
      </div>

      <div className="mt-8">
        <AssessmentsTable rows={rows} />
      </div>
    </main>
  );
}
