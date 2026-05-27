"use client";

/**
 * MatchingAnswerInput — pair-each-LHS-to-an-RHS, Phase 2 question type.
 *
 * Reads `lhs[]` (anchors, shown stacked) and `rhs[]` (options, shown in
 * a single dropdown next to each LHS) from question.interactiveConfig.
 *
 * The picker UI is intentionally a select per LHS row rather than
 * drag-and-line because:
 *   - works on touch (mobile candidates),
 *   - works for screen-reader users without extra ARIA wiring,
 *   - simpler to validate (one selection per LHS row).
 *
 * Same RHS option may be picked across multiple LHS rows if the author
 * permits it (we don't enforce uniqueness here — the scorer does).
 *
 * On submit emits AnswerPayload.structuredAnswer = { pairs: [[lhsId, rhsId], …] }.
 */

import { useMemo, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

const matchingConfigSchema = z.object({
  lhs: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .min(2),
  rhs: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .min(2),
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function MatchingAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const result = matchingConfigSchema.safeParse(question.interactiveConfig);
    return result.success ? result.data : null;
  }, [question.interactiveConfig]);

  // Map of lhsId → rhsId (current selection per row). Empty string = unset.
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  if (!parsed) {
    return (
      <div className="rounded-2xl border border-destructive bg-destructive/10 p-4 text-xs text-destructive">
        This matching question has an invalid configuration. Skip to continue.
      </div>
    );
  }

  const { lhs, rhs } = parsed;
  const allFilled = lhs.every((row) => selections[row.id]);

  function handleSubmit() {
    if (disabled || submitted) return;
    setSubmitted(true);
    const pairs: [string, string][] = lhs
      .filter((row) => selections[row.id])
      .map((row) => [row.id, selections[row.id]!]);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: { pairs },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Match each item on the left to one on the right
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {lhs.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr_auto_2fr]"
          >
            <span className="text-sm font-medium">{row.label}</span>
            <span aria-hidden className="hidden text-muted-foreground sm:block">
              →
            </span>
            <select
              value={selections[row.id] ?? ""}
              onChange={(e) =>
                setSelections((prev) => ({ ...prev, [row.id]: e.target.value }))
              }
              disabled={disabled || submitted}
              aria-label={`Match for ${row.label}`}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">— pick a match —</option>
              {rhs.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted || !allFilled}
        title={!allFilled ? "Pick a match for every row before submitting" : undefined}
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : "Submit pairs"}
      </button>
    </div>
  );
}
