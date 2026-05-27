"use client";

/**
 * SliderAnswerInput — Phase 2 question type.
 *
 * Renders a numeric range input + value display + unit label. Reads
 * `min/max/step/unit` from question.interactiveConfig (validated by the
 * type registry on the server when the question was authored).
 *
 * On submit emits AnswerPayload.structuredAnswer = { value, unit }.
 *
 * The deterministic scorer (lib/engines/assessment/question-types/slider.ts)
 * compares value against target_value with tolerance — but the candidate
 * never sees target/tolerance; those are author-side.
 */

import { useMemo, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

const sliderConfigSchema = z.object({
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  unit: z.string().min(1).max(20),
  // target_value + tolerance are author-only; if they leak into the
  // shape we just ignore them.
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function SliderAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const result = sliderConfigSchema.safeParse(question.interactiveConfig);
    if (!result.success) {
      return null;
    }
    return result.data;
  }, [question.interactiveConfig]);

  // Default to the midpoint — feels less leading than starting at min.
  const initialValue = parsed
    ? Math.round((parsed.min + parsed.max) / 2 / parsed.step) * parsed.step
    : 0;
  const [value, setValue] = useState<number>(initialValue);
  const [submitted, setSubmitted] = useState(false);

  if (!parsed) {
    return (
      <div className="rounded-2xl border border-destructive bg-destructive/10 p-4 text-xs text-destructive">
        This slider question has an invalid configuration. Skip to continue.
      </div>
    );
  }

  const { min, max, step, unit } = parsed;
  const valuePct = ((value - min) / (max - min)) * 100;

  function handleSubmit() {
    if (disabled || submitted) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: { value, unit },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Set your answer
      </p>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="text-3xl font-bold tabular-nums text-foreground">
          {formatNumber(value, step)}
        </span>
        <span className="text-sm font-medium text-muted-foreground">{unit}</span>
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
          disabled={disabled || submitted}
          className="w-full accent-etc-marigold"
          aria-label={`Numeric answer in ${unit}`}
        />
        <div className="mt-1 flex justify-between text-[0.65rem] text-muted-foreground tabular-nums">
          <span>
            {formatNumber(min, step)} {unit}
          </span>
          <span>
            {formatNumber(max, step)} {unit}
          </span>
        </div>
      </div>

      {/* Visual track marker — purely cosmetic for the value's relative position */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-etc-marigold transition-all"
          style={{ width: `${valuePct}%` }}
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted}
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

/**
 * Format the value with enough decimal places to honour the step
 * (so step=0.5 shows "12.5", step=1 shows "12", step=10 shows "120").
 */
function formatNumber(value: number, step: number): string {
  if (step >= 1) return value.toFixed(0);
  if (step >= 0.1) return value.toFixed(1);
  if (step >= 0.01) return value.toFixed(2);
  return value.toFixed(3);
}
