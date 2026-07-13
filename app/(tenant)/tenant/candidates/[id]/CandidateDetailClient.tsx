"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

type Finding = {
  text: string;
  severity: "info" | "warn" | "critical";
  category: string;
};

type SubmissionRow = {
  answer_id: string | null;
  question_id: string;
  question_text: string;
  question_type: string;
  candidate_answer_text: string | null;
  ai_auto_score: number | null;
  final_score: number | null;
  points_awarded: number | null;
  ai_rationale: string | null;
  override: {
    new_score: unknown;
    reason_category: string;
    reason_text: string;
  } | null;
};

type Initial = {
  response_id: string;
  candidate_name: string;
  candidate_email: string;
  assessment_title: string;
  status: string;
  decision: string;
  total_score: number | null;
  max_possible_score: number;
  submitted_at: string | null;
  time_spent_seconds: number | null;
  integrity_findings: Finding[];
  submission: SubmissionRow[];
};

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatDecision(decision: string): string {
  return decision.replace(/_/g, " ");
}

export function CandidateDetailClient({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [openOverrideFor, setOpenOverrideFor] = useState<string | null>(null);
  const [reassessing, setReassessing] = useState(false);
  const [reassessError, setReassessError] = useState<string | null>(null);

  const reassess = async () => {
    if (!confirm("Send the candidate a fresh assessment link? This consumes one slot.")) {
      return;
    }
    setReassessing(true);
    setReassessError(null);
    try {
      const res = await fetch(
        `/api/v1/tenant/candidate-responses/${initial.response_id}/reassess`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setReassessError(body.error ?? `${res.status}`);
        setReassessing(false);
        return;
      }
      router.refresh();
    } catch {
      setReassessError("Reassessment failed.");
      setReassessing(false);
    }
  };

  const trafficLight =
    initial.integrity_findings.some((f) => f.severity === "critical")
      ? "red"
      : initial.integrity_findings.some((f) => f.severity === "warn")
        ? "amber"
        : "green";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {initial.assessment_title}
        </p>
        <h1 className="text-2xl font-bold">{initial.candidate_name}</h1>
        <p className="text-xs text-muted-foreground">{initial.candidate_email}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Decision" value={formatDecision(initial.decision)} accent />
        <Stat
          label="Score"
          value={
            initial.total_score !== null
              ? `${initial.total_score} / ${initial.max_possible_score}`
              : "—"
          }
        />
        <Stat label="Time" value={formatDuration(initial.time_spent_seconds)} />
        <Stat label="Status" value={initial.status} />
      </section>

      <section className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-xs">
        <div>
          <p className="font-semibold">Need a second look?</p>
          <p className="text-muted-foreground">
            Send the candidate a fresh assessment, excluding the questions
            they&apos;ve already seen. 1 reassessment per candidate.
          </p>
        </div>
        <button
          type="button"
          onClick={reassess}
          disabled={reassessing}
          className="inline-flex h-9 items-center rounded-lg border border-foreground px-3 text-xs font-semibold disabled:opacity-60"
        >
          {reassessing ? "Sending..." : "Reassess"}
        </button>
      </section>
      {reassessError && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {reassessError === "reassessment_cap_reached"
            ? "This candidate has already used their reassessment for this assessment."
            : reassessError === "insufficient_slots"
              ? "Not enough candidate slots. Top up to send a reassessment."
              : reassessError}
        </p>
      )}

      <section
        className={cn(
          "rounded-2xl border p-4",
          trafficLight === "red"
            ? "border-destructive bg-destructive/5"
            : trafficLight === "amber"
              ? "border-amber-400 bg-amber-50"
              : "border-green-300 bg-green-50",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              trafficLight === "red"
                ? "bg-destructive"
                : trafficLight === "amber"
                  ? "bg-amber-500"
                  : "bg-green-500",
            )}
          />
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider text-foreground">
            Integrity report
          </h2>
        </div>
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-foreground">
          {initial.integrity_findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="mt-1 shrink-0 text-muted-foreground">
                •
              </span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Per-question submission
        </h2>
        <div className="mt-3 space-y-3">
          {initial.submission.map((s, idx) => (
            <article
              key={s.question_id}
              className="rounded-2xl border border-border bg-card p-5 text-xs shadow-sm"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-[0.65rem] font-semibold text-muted-foreground">
                  Q{idx + 1}
                </span>
                <p className="font-medium leading-relaxed text-foreground">
                  {s.question_text}
                </p>
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-foreground">
                {s.candidate_answer_text ?? (
                  <span className="italic text-muted-foreground">
                    (no answer captured)
                  </span>
                )}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-[0.65rem]">
                <ScoreCell label="Algorithm" value={s.ai_auto_score} />
                <ScoreCell label="Mark" value={s.points_awarded} />
                <ScoreCell label="Final" value={s.final_score} />
              </dl>
              {s.ai_rationale && (
                <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2 text-[0.65rem] italic text-muted-foreground">
                  {s.ai_rationale}
                </p>
              )}
              {s.override && (
                <p className="mt-3 rounded-lg border border-etc-marigold bg-etc-marigold/10 p-2 text-[0.65rem] text-etc-black">
                  <span className="font-semibold">Score overridden</span>{" "}
                  ({s.override.reason_category}): {s.override.reason_text}
                </p>
              )}
              <div className="mt-4 flex justify-end border-t border-border/40 pt-3">
                <button
                  type="button"
                  onClick={() => setOpenOverrideFor(s.question_id)}
                  className="text-[0.7rem] font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  Override score
                </button>
              </div>
              {openOverrideFor === s.question_id && (
                <OverrideForm
                  responseId={initial.response_id}
                  questionId={s.question_id}
                  answerId={s.answer_id}
                  onClose={() => setOpenOverrideFor(null)}
                  onDone={() => {
                    setOpenOverrideFor(null);
                    router.refresh();
                  }}
                />
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        accent ? "border-foreground bg-foreground/5" : "border-border bg-card",
      )}
    >
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold capitalize">{value}</p>
    </div>
  );
}

function ScoreCell({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold text-foreground">
        {value !== null ? value : "—"}
      </p>
    </div>
  );
}

function OverrideForm({
  responseId,
  questionId,
  answerId,
  onClose,
  onDone,
}: {
  responseId: string;
  questionId: string;
  answerId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newScore, setNewScore] = useState("");
  const [category, setCategory] = useState("too_harsh");
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (reasonText.trim().length < 20) {
      setError("Please give at least 20 characters explaining the override.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/tenant/candidate-responses/${responseId}/override`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question_id: questionId,
            answer_id: answerId,
            new_score: { value: newScore },
            reason_category: category,
            reason_text: reasonText.trim(),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `${res.status}`);
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError("Override failed.");
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-3 text-[0.7rem]">
      <p className="text-[0.65rem] text-muted-foreground">
        Your override helps the algorithm learn. Both the new score and your
        reason will be used to improve scoring quality across all future
        assessments — not just this candidate&apos;s.
      </p>
      <label className="block">
        <span className="font-medium">New score</span>
        <input
          value={newScore}
          onChange={(e) => setNewScore(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2"
          placeholder="e.g. 4, 100, pass"
        />
      </label>
      <label className="block">
        <span className="font-medium">Reason</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-2"
        >
          <option value="too_harsh">Algorithm scored too harshly</option>
          <option value="too_lenient">Algorithm scored too leniently</option>
          <option value="missed_context">Algorithm missed context</option>
          <option value="cultural_nuance">Cultural / regional nuance</option>
          <option value="translation_issue">Language / translation issue</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block">
        <span className="font-medium">Notes (min 20 chars)</span>
        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-input bg-background p-2"
          placeholder="What did the algorithm miss? Be specific."
        />
      </label>
      {error && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save override"}
        </button>
      </div>
    </div>
  );
}
