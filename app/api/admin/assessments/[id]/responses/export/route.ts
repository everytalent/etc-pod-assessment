/**
 * GET /api/admin/assessments/[id]/responses/export — CSV download.
 *
 * One row per candidate response. For each question in the assessment, two
 * extra columns are appended: `q{N}_answer` (the option label or text) and
 * `q{N}_score` (points awarded). This shape pivots cleanly in Excel.
 *
 * Security: gated by requireAdminApi() — any allow-listed admin can export.
 * Streamed as text/csv so big lists don't materialise in memory.
 */

import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  answers,
  assessments,
  questions,
  responses,
  type QuestionOption,
} from "@/lib/db/schema";

/** RFC 4180 escaping: wrap in quotes, double internal quotes. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Strip CR/LF — keeps each row on one logical line for naive parsers.
  s = s.replace(/\r?\n/g, " ");
  if (/[",]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",");
}

function labelFor(selected: string[], options: QuestionOption[]): string {
  if (selected.length === 0) return "";
  return selected
    .map((id) => options.find((o) => o.id === id)?.label ?? id)
    .join(" | ");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [assessment] = await db
    .select({ id: assessments.id, title: assessments.title, slug: assessments.slug })
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Stable column order — sorted by orderIndex.
  const qList = await db
    .select({
      id: questions.id,
      text: questions.questionText,
      orderIndex: questions.orderIndex,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
    })
    .from(questions)
    .where(eq(questions.assessmentId, id))
    .orderBy(asc(questions.orderIndex));

  const responseRows = await db
    .select()
    .from(responses)
    .where(eq(responses.assessmentId, id))
    .orderBy(desc(responses.startedAt));

  const allAnswers = await db
    .select({
      responseId: answers.responseId,
      questionId: answers.questionId,
      selectedOptions: answers.selectedOptions,
      textResponse: answers.textResponse,
      audioPath: answers.audioPath,
      audioDurationSeconds: answers.audioDurationSeconds,
      scoreAwarded: answers.scoreAwarded,
      timeSpentSeconds: answers.timeSpentSeconds,
      timedOut: answers.timedOut,
    })
    .from(answers)
    .innerJoin(responses, eq(responses.id, answers.responseId))
    .where(eq(responses.assessmentId, id));

  // Index answers by responseId → questionId → row.
  const byResponse = new Map<string, Map<string, (typeof allAnswers)[number]>>();
  for (const a of allAnswers) {
    let inner = byResponse.get(a.responseId);
    if (!inner) {
      inner = new Map();
      byResponse.set(a.responseId, inner);
    }
    inner.set(a.questionId, a);
  }

  const baseHeader = [
    "response_id",
    "candidate_name",
    "candidate_email",
    "candidate_phone",
    "status",
    "pass",
    "total_score",
    "max_possible_score",
    "started_at",
    "submitted_at",
    "time_on_task_seconds",
  ];
  const questionHeaders = qList.flatMap((q, i) => [
    `q${i + 1}_answer`,
    `q${i + 1}_score`,
  ]);
  const header = [...baseHeader, ...questionHeaders];

  const lines: string[] = [csvRow(header)];

  for (const r of responseRows) {
    const answersByQ = byResponse.get(r.id) ?? new Map();
    const row: unknown[] = [
      r.id,
      r.candidateName,
      r.candidateEmail,
      r.candidatePhone ?? "",
      r.status,
      r.pass === null ? "" : r.pass ? "true" : "false",
      r.totalScore ?? "",
      r.maxPossibleScore,
      r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
      r.submittedAt
        ? r.submittedAt instanceof Date
          ? r.submittedAt.toISOString()
          : String(r.submittedAt)
        : "",
      r.metadata.time_on_task_seconds ?? "",
    ];
    for (const q of qList) {
      const ans = answersByQ.get(q.id);
      if (!ans) {
        row.push("", "");
      } else {
        // For open-ended, the "answer" cell is either the typed text or a
        // [voice X:XX] tag. CSV stays one cell per question — adding more
        // columns just for audio path would explode the column count for
        // assessments with many open-ended Qs. Reviewers fetch the audio
        // via the admin drill-in.
        let answerCell: string;
        if (ans.textResponse) {
          answerCell = ans.textResponse;
        } else if (ans.audioPath) {
          const dur =
            ans.audioDurationSeconds != null
              ? `${Math.floor(ans.audioDurationSeconds / 60)}:${String(ans.audioDurationSeconds % 60).padStart(2, "0")}`
              : "?";
          answerCell = `[voice ${dur}] ${ans.audioPath}`;
        } else {
          answerCell = labelFor(ans.selectedOptions, q.options);
        }
        row.push(answerCell, ans.scoreAwarded);
      }
    }
    lines.push(csvRow(row));
  }

  const filename = `${assessment.slug}-responses-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store",
    },
  });
}
