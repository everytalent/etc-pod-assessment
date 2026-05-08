"use client";

/**
 * Drill-in modal — fetches the response detail (incl. answer rows joined
 * with question text + correct_answer for review) and renders the path the
 * candidate took with per-question timing.
 */

import { useEffect, useState } from "react";

import type {
  QuestionOption,
  Response,
} from "@/lib/db/schema";

type AnswerRow = {
  answerId: string;
  questionId: string;
  selectedOptions: string[];
  timeSpentSeconds: number;
  timedOut: boolean;
  scoreAwarded: number;
  answeredAt: string;
  questionText: string;
  questionType: string;
  options: QuestionOption[];
  correctAnswer: string[];
  orderIndex: number;
  points: number;
  negativePoints: number;
  section: string | null;
};

type Detail = {
  response: Response;
  answers: AnswerRow[];
};

export function ResponseDrillIn({
  responseId,
  onClose,
}: {
  responseId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/responses/${responseId}`);
        if (!res.ok) throw new Error(`load failed: ${res.status}`);
        const json = (await res.json()) as Detail;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [responseId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Response
            </p>
            <h2 className="mt-1 text-xl font-bold">
              {data ? data.response.candidateName : "Loading…"}
            </h2>
            {data && (
              <p className="text-xs text-muted-foreground">
                {data.response.candidateEmail}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:border-etc-marigold"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        )}

        {data && (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Stat label="Status" value={data.response.status.replace("_", " ")} />
              <Stat
                label="Score"
                value={
                  data.response.totalScore !== null
                    ? `${data.response.totalScore} / ${data.response.maxPossibleScore}`
                    : "—"
                }
              />
              <Stat
                label="Pass"
                value={
                  data.response.pass === true
                    ? "Yes"
                    : data.response.pass === false
                    ? "No"
                    : "—"
                }
              />
              <Stat
                label="Time"
                value={
                  data.response.metadata.time_on_task_seconds != null
                    ? `${Math.round(
                        data.response.metadata.time_on_task_seconds / 60,
                      )}m`
                    : "—"
                }
              />
            </dl>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Path ({data.answers.length} answer{data.answers.length === 1 ? "" : "s"})
            </h3>
            <ol className="mt-3 flex flex-col gap-3">
              {data.answers.map((a, i) => (
                <li
                  key={a.answerId}
                  className="rounded-2xl border border-border bg-background p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-muted-foreground">
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{a.questionText}</p>
                      <p className="mt-1 text-[0.7rem] text-muted-foreground">
                        {renderSelected(a)} · {a.scoreAwarded > 0 ? "+" : ""}
                        {a.scoreAwarded} pts · {a.timeSpentSeconds}s
                        {a.timedOut && " · TIMED OUT"}
                      </p>
                      {a.correctAnswer.length > 0 && (
                        <p className="mt-1 text-[0.7rem] text-muted-foreground">
                          Correct: {renderLabels(a.correctAnswer, a.options)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function renderSelected(a: AnswerRow): string {
  if (a.selectedOptions.length === 0) return "(no answer)";
  return `Picked: ${renderLabels(a.selectedOptions, a.options)}`;
}

function renderLabels(ids: string[], options: QuestionOption[]): string {
  return ids
    .map((id) => options.find((o) => o.id === id)?.label ?? id)
    .join(", ");
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}
