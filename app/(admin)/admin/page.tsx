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
import {
  adminUsers,
  answers,
  assessments,
  questions,
  responses,
} from "@/lib/db/schema";

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

  // System-wide score-source breakdown — only meaningful for open-ended
  // answers that have been graded. Manual entries vs. accepted AI
  // suggestions, with the source labelled.
  const [scoreSourceTotals] = await db
    .select({
      manual: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'manual' THEN 1 END)::int`,
      aiGemini: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'ai_gemini' THEN 1 END)::int`,
      aiKimi: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'ai_kimi' THEN 1 END)::int`,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .where(sql`${questions.type} = 'open' AND ${answers.scoredAt} IS NOT NULL`);

  const perAssessor = await db
    .select({
      scorerId: answers.scoredBy,
      email: adminUsers.email,
      role: adminUsers.role,
      manual: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'manual' THEN 1 END)::int`,
      aiGemini: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'ai_gemini' THEN 1 END)::int`,
      aiKimi: sql<number>`COUNT(CASE WHEN ${answers.scoreSource} = 'ai_kimi' THEN 1 END)::int`,
    })
    .from(answers)
    .innerJoin(questions, eq(questions.id, answers.questionId))
    .innerJoin(adminUsers, eq(adminUsers.id, answers.scoredBy))
    .where(sql`${questions.type} = 'open' AND ${answers.scoredAt} IS NOT NULL`)
    .groupBy(answers.scoredBy, adminUsers.email, adminUsers.role)
    .orderBy(
      desc(
        sql`COUNT(${answers.id})`,
      ),
    );

  const totals = scoreSourceTotals ?? { manual: 0, aiGemini: 0, aiKimi: 0 };
  const grand = totals.manual + totals.aiGemini + totals.aiKimi;
  const pct = (n: number) => (grand > 0 ? Math.round((n * 100) / grand) : 0);

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

      {grand > 0 && (
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Score source · open-ended only
          </p>
          <h2 className="mt-1 text-lg font-bold">
            {grand} graded answer{grand === 1 ? "" : "s"} system-wide
          </h2>

          <ul className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-foreground" />
              Manual {totals.manual} · {pct(totals.manual)}%
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-etc-marigold" />
              From 1st assessor {totals.aiGemini} · {pct(totals.aiGemini)}%
            </li>
            <li className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
              From 2nd assessor {totals.aiKimi} · {pct(totals.aiKimi)}%
            </li>
          </ul>

          {perAssessor.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Per assessor
              </summary>
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1">Reviewer</th>
                    <th className="py-1 text-right">Manual</th>
                    <th className="py-1 text-right">1st</th>
                    <th className="py-1 text-right">2nd</th>
                  </tr>
                </thead>
                <tbody>
                  {perAssessor.map((p) => (
                    <tr key={p.scorerId ?? p.email} className="border-t border-border">
                      <td className="py-1.5">
                        {p.email}{" "}
                        <span className="text-muted-foreground">({p.role})</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{p.manual}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.aiGemini}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.aiKimi}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      <div className="mt-8">
        <AssessmentsTable rows={rows} />
      </div>
    </main>
  );
}
