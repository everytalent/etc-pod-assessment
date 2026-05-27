"use client";

/**
 * ScenarioAnswerInput — multi-step decision walk-through, Phase 2.
 *
 * Reads `steps[]` (each with prompt + choices) and `require_rationale`
 * from question.interactiveConfig. The candidate walks through each
 * step in order, picks one choice per step, then writes a rationale
 * if the question requires it.
 *
 * Note on choice ordering: we display the choices in the author-given
 * order. We do NOT shuffle here because some scenarios use ordered
 * options (e.g. "least → most aggressive intervention").
 *
 * Submits structuredAnswer = { steps: [{step_id, choice_id}, …], rationale_text? }.
 * Deterministic scorer in the registry handles choice scoring; rationale
 * (if present) is AI-scored downstream.
 */

import { useMemo, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

const scenarioConfigSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        prompt: z.string().min(1),
        choices: z
          .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
          .min(2),
      }),
    )
    .min(1),
  require_rationale: z.boolean().default(false),
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function ScenarioAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const result = scenarioConfigSchema.safeParse(question.interactiveConfig);
    return result.success ? result.data : null;
  }, [question.interactiveConfig]);

  // picks[stepId] = choiceId
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (!parsed) {
    return (
      <div className="rounded-2xl border border-destructive bg-destructive/10 p-4 text-xs text-destructive">
        This scenario question has an invalid configuration. Skip to continue.
      </div>
    );
  }

  const { steps, require_rationale } = parsed;
  const allStepsAnswered = steps.every((s) => picks[s.id]);
  const rationaleReady = !require_rationale || rationale.trim().length >= 20;
  const canSubmit = allStepsAnswered && rationaleReady && !disabled && !submitted;

  function handleSubmit() {
    if (!canSubmit) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: {
        steps: steps.map((s) => ({ step_id: s.id, choice_id: picks[s.id]! })),
        rationale_text: require_rationale ? rationale.trim() : undefined,
      },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Work through each step in order
      </p>

      <ol className="mt-3 space-y-4">
        {steps.map((step, idx) => (
          <li key={step.id} className="rounded-xl border border-border bg-background p-3">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-etc-marigold/30 text-[0.65rem] font-bold tabular-nums">
                {idx + 1}
              </span>
              <p className="text-sm font-medium">{step.prompt}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {step.choices.map((choice) => {
                const picked = picks[step.id] === choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={disabled || submitted}
                    onClick={() =>
                      setPicks((prev) => ({ ...prev, [step.id]: choice.id }))
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      picked
                        ? "border-etc-marigold bg-etc-marigold/15"
                        : "border-border bg-card hover:border-etc-marigold/60",
                      (disabled || submitted) && "cursor-not-allowed opacity-70",
                    )}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {require_rationale && (
        <div className="mt-4">
          <label className="block">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Rationale (≥20 characters — AI-scored)
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={disabled || submitted}
              placeholder="Briefly explain why you chose the path above…"
              className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-2 text-sm disabled:opacity-60"
              aria-label="Scenario rationale"
            />
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              {rationale.length} / 4000 · need at least 20
            </p>
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        title={
          !allStepsAnswered
            ? "Answer every step before submitting"
            : !rationaleReady
              ? "Rationale must be at least 20 characters"
              : undefined
        }
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : "Submit scenario"}
      </button>
    </div>
  );
}
