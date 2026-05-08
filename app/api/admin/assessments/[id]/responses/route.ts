/**
 * GET /api/admin/assessments/[id]/responses — list responses for an
 * assessment with summary columns. Drives the response table (PRD §7
 * acceptance: "renders 100 seeded fake responses in under 500ms").
 *
 * The query is a single-pass select with the assessment's pass_threshold
 * already joined in, so the table can render without secondary queries.
 */

import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers, responses } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const rows = await db
    .select({
      id: responses.id,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      candidatePhone: responses.candidatePhone,
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

  return NextResponse.json({ responses: rows });
}
