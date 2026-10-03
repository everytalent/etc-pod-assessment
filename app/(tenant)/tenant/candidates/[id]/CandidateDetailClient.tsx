"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Tenant candidate detail. Laid out like the admin response drill-in
 * (status / score / pass / time, integrity signal chips, then the path with
 * every question showing what was picked, what was correct, points and
 * time) so the two surfaces read the same. Tenant-only actions (reassess,
 * score override) stay; admin-only controls are not here.
 */

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
  picked: string[];
  correct: string[];
  has_audio: boolean;
  time_spent_seconds: number;
  timed_out: boolean;
  max_points: number;
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
  pass: boolean | null;
  integrity_findings: Finding[];
  signals: {
    session_loads: number;
    tab_switches: number;
    paste_events: number;
    ip_changed: boolean;
  };
  submission: SubmissionRow[];
};

function formatMinutes(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "-";
  return `${Math.max(1, Math.round(seconds / 60))}m`;
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

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Response · {initial.assessment_title}
          </p>
          <h1 className="mt-1 text-xl font-bold">{initial.candidate_name}</h1>
          <p className="text-xs text-muted-foreground">{initial.candidate_email}</p>
        </div>
        <button
          type="button"
          onClick={reassess}
          disabled={reassessing}
          title="Send the candidate a fresh assessment, excluding the questions they have already seen. One reassessment per candidate."
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:border-etc-marigold disabled:opacity-60"
        >
          {reassessing ? "Sending..." : "Reassess"}
        </button>
      </div>
      {reassessError && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {reassessError === "reassessment_cap_reached"
            ? "This candidate has already used their reassessment for this assessment."
            : reassessError === "insufficient_slots"
              ? "Not enough candidate slots. Top up to send a reassessment."
              : reassessError}
        </p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <Stat label="Status" value={initial.status.replace(/_/g, " ")} />
        <Stat
          label="Score"
          value={
            initial.total_score !== null
              ? `${initial.total_score} / ${initial.max_possible_score}`
              : "-"
          }
        />
        <Stat
          label="Pass"
          value={initial.pass === true ? "Yes" : initial.pass === false ? "No" : "-"}
        />
        <Stat label="Time" value={formatMinutes(initial.time_spent_seconds)} />
      </dl>

      <IntegritySignals signals={initial.signals} findings={initial.integrity_findings} />

      <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Path ({initial.submission.length} answer{initial.submission.length === 1 ? "" : "s"})
      </h3>
      <ol className="mt-3 flex flex-col gap-3">
        {initial.submission.map((s, idx) => (
          <AnswerCard
            key={s.question_id}
            index={idx}
            answer={s}
            overrideOpen={openOverrideFor === s.question_id}
            onOpenOverride={() => setOpenOverrideFor(s.question_id)}
            onCloseOverride={() => setOpenOverrideFor(null)}
            onOverridden={() => {
              setOpenOverrideFor(null);
              router.refresh();
            }}
            responseId={initial.response_id}
          />
        ))}
      </ol>
    </div>
  );
}

/* ---------- Stat card (same as the admin drill-in) ---------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium capitalize text-foreground">{value}</dd>
    </div>
  );
}

/* ---------- Integrity signals (soft, never auto-blocking) ---------- */

function IntegritySignals({
  signals,
  findings,
}: {
  signals: Initial["signals"];
  findings: Finding[];
}) {
  const items: { label: string; value: string; tone: "muted" | "warn" }[] = [];
  if (signals.session_loads > 1) {
    items.push({
      label: "Session loads",
      value: String(signals.session_loads),
      tone: signals.session_loads >= 4 ? "warn" : "muted",
    });
  }
  if (signals.tab_switches > 0) {
    items.push({
      label: "Tab switches",
      value: String(signals.tab_switches),
      tone: signals.tab_switches >= 3 ? "warn" : "muted",
    });
  }
  if (signals.paste_events > 0) {
    items.push({ label: "Paste events", value: String(signals.paste_events), tone: "warn" });
  }
  if (signals.ip_changed) {
    items.push({ label: "IP changed", value: "start ≠ submit", tone: "warn" });
  }
  const notable = findings.filter((f) => f.severity !== "info");

  if (items.length === 0 && notable.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Integrity signals
        </p>
        <p className="mt-2 text-[0.7rem] text-muted-foreground">
          Nothing unusual was recorded during this attempt.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-dashed border-border bg-background/60 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Integrity signals
      </p>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.map((it) => (
            <li key={it.label}>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.7rem]",
                  it.tone === "warn"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <span className="font-medium">{it.label}:</span> {it.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      {notable.length > 0 && (
        <ul className="mt-2 space-y-1 text-[0.7rem] leading-relaxed text-foreground">
          {notable.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  f.severity === "critical" ? "bg-destructive" : "bg-amber-500",
                )}
              />
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[0.65rem] text-muted-foreground">
        Soft signals only, never auto-blocking. Poor connectivity can drive
        loads and tab switches up on legitimate candidates.
      </p>
    </div>
  );
}

/* ---------- Per-answer card ---------- */

function summariseSelection(a: SubmissionRow): string {
  if (a.question_type === "open") {
    if (a.has_audio) return "Voice response";
    if (a.candidate_answer_text) return "Text response";
    return "(no response)";
  }
  if (a.picked.length === 0) return "(no answer)";
  return `Picked: ${a.picked.join(", ")}`;
}

function AnswerCard({
  index,
  answer,
  overrideOpen,
  onOpenOverride,
  onCloseOverride,
  onOverridden,
  responseId,
}: {
  index: number;
  answer: SubmissionRow;
  overrideOpen: boolean;
  onOpenOverride: () => void;
  onCloseOverride: () => void;
  onOverridden: () => void;
  responseId: string;
}) {
  const isOpen = answer.question_type === "open";
  const pts = answer.points_awarded ?? 0;
  const pickedRight =
    !isOpen &&
    answer.correct.length > 0 &&
    answer.picked.length === answer.correct.length &&
    answer.picked.every((p) => answer.correct.includes(p));

  return (
    <li className="rounded-2xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-muted-foreground">
          #{index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{answer.question_text}</p>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            <span className={cn(pickedRight && "text-green-700")}>
              {summariseSelection(answer)}
            </span>
            {" · "}
            {pts > 0 ? "+" : ""}
            {pts} / {answer.max_points} pts · {answer.time_spent_seconds}s
            {answer.timed_out && " · TIMED OUT"}
          </p>
          {answer.correct.length > 0 && (
            <p className="mt-1 text-[0.7rem] text-muted-foreground">
              Correct: {answer.correct.join(", ")}
            </p>
          )}
        </div>
      </div>

      {isOpen && (
        <div className="mt-3 space-y-2">
          <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs text-foreground">
            {answer.candidate_answer_text ?? (
              <span className="italic text-muted-foreground">
                {answer.has_audio
                  ? "Voice response; transcript not yet available."
                  : "(no response captured)"}
              </span>
            )}
          </p>
          {answer.ai_rationale && (
            <p className="rounded-lg border border-border/60 bg-muted/20 p-2 text-[0.65rem] italic text-muted-foreground">
              {answer.ai_rationale}
            </p>
          )}
        </div>
      )}

      {answer.override && (
        <p className="mt-3 rounded-lg border border-etc-marigold bg-etc-marigold/10 p-2 text-[0.65rem] text-etc-black">
          <span className="font-semibold">Score overridden</span>{" "}
          ({answer.override.reason_category.replace(/_/g, " ")}): {answer.override.reason_text}
        </p>
      )}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={overrideOpen ? onCloseOverride : onOpenOverride}
          className="text-[0.7rem] font-semibold text-foreground underline-offset-4 hover:underline"
        >
          {overrideOpen ? "Cancel override" : "Override score"}
        </button>
      </div>
      {overrideOpen && (
        <OverrideForm
          responseId={responseId}
          questionId={answer.question_id}
          answerId={answer.answer_id}
          onClose={onCloseOverride}
          onDone={onOverridden}
        />
      )}
    </li>
  );
}

/* ---------- Override form (tenant action) ---------- */

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
        Your override helps the scoring learn. Both the new score and your
        reason are used to improve scoring across all future assessments, not
        just this candidate&apos;s.
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
          <option value="too_harsh">Scored too harshly</option>
          <option value="too_lenient">Scored too leniently</option>
          <option value="missed_context">Missed context</option>
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
          placeholder="What was missed? Be specific."
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
