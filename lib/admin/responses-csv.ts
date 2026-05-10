/**
 * Shared CSV generator for the responses table.
 *
 * Used by:
 *   - GET /api/admin/assessments/[id]/responses/export      → direct CSV download
 *   - POST /api/admin/assessments/[id]/responses/export-zoho → CSV uploaded to WorkDrive
 *
 * One row per response. Two columns per question (`q{N}_answer`, `q{N}_score`).
 * Open-ended text responses go verbatim into the answer cell; voice answers
 * become `[voice M:SS] <storage-path>` so reviewers can locate the audio.
 */

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  answers,
  assessments,
  questions,
  responses,
  type QuestionOption,
} from "@/lib/db/schema";

/** RFC 4180 escaping. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
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

export type BuildCsvResult = {
  /** Full CSV text including header row. */
  csv: string;
  /** How many responses were included. */
  responseCount: number;
  /** How many voice answers exist in the included responses. */
  voiceAnswerCount: number;
  /** Total bytes of voice audio referenced (rough — based on `audioDurationSeconds`). */
  voiceTotalSeconds: number;
  /** Slug of the assessment (used for filename). */
  assessmentSlug: string;
  assessmentTitle: string;
};

/**
 * Build the CSV for an assessment's responses, optionally filtered to a
 * specific subset of response IDs. Pass {@link options.responseIds} to
 * scope; omit to include everything for the assessment.
 */
export async function buildResponsesCsv(args: {
  assessmentId: string;
  /** If provided, only these response rows are included. */
  responseIds?: string[];
  /** If true (default), preview-tagged responses are excluded. */
  excludePreview?: boolean;
}): Promise<BuildCsvResult> {
  const excludePreview = args.excludePreview ?? true;

  const [assessment] = await db
    .select({
      id: assessments.id,
      title: assessments.title,
      slug: assessments.slug,
    })
    .from(assessments)
    .where(eq(assessments.id, args.assessmentId))
    .limit(1);
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  const qList = await db
    .select({
      id: questions.id,
      text: questions.questionText,
      orderIndex: questions.orderIndex,
      options: questions.options,
      correctAnswer: questions.correctAnswer,
    })
    .from(questions)
    .where(eq(questions.assessmentId, args.assessmentId))
    .orderBy(asc(questions.orderIndex));

  let responseRows = await db
    .select()
    .from(responses)
    .where(
      args.responseIds && args.responseIds.length > 0
        ? inArray(responses.id, args.responseIds)
        : eq(responses.assessmentId, args.assessmentId),
    )
    .orderBy(desc(responses.startedAt));

  // If responseIds were passed, we still want to scope to this assessment
  // (defence — caller might pass IDs that span multiple assessments).
  responseRows = responseRows.filter(
    (r) => r.assessmentId === args.assessmentId,
  );
  if (excludePreview) {
    responseRows = responseRows.filter(
      (r) => r.metadata.preview !== true,
    );
  }

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
    .where(eq(responses.assessmentId, args.assessmentId));

  // Index answers by responseId → questionId.
  const byResponse = new Map<
    string,
    Map<string, (typeof allAnswers)[number]>
  >();
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

  let voiceAnswerCount = 0;
  let voiceTotalSeconds = 0;

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
      r.startedAt instanceof Date
        ? r.startedAt.toISOString()
        : String(r.startedAt),
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
        let answerCell: string;
        if (ans.textResponse) {
          answerCell = ans.textResponse;
        } else if (ans.audioPath) {
          voiceAnswerCount += 1;
          if (ans.audioDurationSeconds != null) {
            voiceTotalSeconds += ans.audioDurationSeconds;
          }
          const dur =
            ans.audioDurationSeconds != null
              ? `${Math.floor(ans.audioDurationSeconds / 60)}:${String(
                  ans.audioDurationSeconds % 60,
                ).padStart(2, "0")}`
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

  return {
    csv: lines.join("\n"),
    responseCount: responseRows.length,
    voiceAnswerCount,
    voiceTotalSeconds,
    assessmentSlug: assessment.slug,
    assessmentTitle: assessment.title,
  };
}
