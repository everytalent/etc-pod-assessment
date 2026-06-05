"use client";

/**
 * FormulaAnswerInput — numeric answer + unit + optional working text.
 *
 * Reads `unit` from question.interactiveConfig (the target value and
 * tolerance are author-only; never revealed to the candidate).
 *
 * structuredAnswer:
 *   { value: number, unit: string, working?: string }
 *
 * The type registry's deterministic scorer compares value against
 * target_value with the configured tolerance; the working text is
 * AI-scored downstream for partial credit on reasoning.
 *
 * Falls back to InvalidConfigTextFallback if the unit isn't authored —
 * happens when Opus produces a malformed formula config.
 */

import { useMemo, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

import { InvalidConfigTextFallback } from "./InvalidConfigTextFallback";

const formulaConfigSchema = z.object({
  unit: z.string().min(1).max(20),
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function FormulaAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const r = formulaConfigSchema.safeParse(question.interactiveConfig);
    return r.success ? r.data : null;
  }, [question.interactiveConfig]);

  const [valueText, setValueText] = useState("");
  const [working, setWorking] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!parsed) {
    return (
      <InvalidConfigTextFallback
        onSubmit={onSubmit}
        disabled={disabled}
        hint="Type your numeric answer and reasoning."
      />
    );
  }

  const { unit } = parsed;
  const parsedValue = Number(valueText.replace(/,/g, ""));
  const numericValid =
    valueText.trim().length > 0 && Number.isFinite(parsedValue);

  function handleSubmit() {
    if (disabled || submitted || !numericValid) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: {
        value: parsedValue,
        unit,
        working: working.trim().length > 0 ? working.trim() : undefined,
      },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Enter your answer
      </p>

      <div className="mt-3 flex items-end gap-2">
        <label className="flex-1">
          <span className="block text-[0.7rem] font-medium text-muted-foreground">
            Value
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={valueText}
            onChange={(e) => setValueText(e.target.value)}
            disabled={disabled || submitted}
            placeholder="e.g. 12.5"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-lg tabular-nums"
            aria-label="Numeric answer"
          />
        </label>
        <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-medium">
          {unit}
        </div>
      </div>

      <label className="mt-3 block">
        <span className="block text-[0.7rem] font-medium text-muted-foreground">
          Working / reasoning (optional)
        </span>
        <textarea
          value={working}
          onChange={(e) => setWorking(e.target.value)}
          disabled={disabled || submitted}
          rows={3}
          maxLength={4000}
          placeholder="Show the formula or assumptions you used. Helps the reviewer give partial credit."
          className="mt-1 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm"
          aria-label="Working / reasoning"
        />
      </label>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted || !numericValid}
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : "Submit answer"}
      </button>
    </div>
  );
}
