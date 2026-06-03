"use client";

/**
 * Fallback UI for interactive questions whose interactiveConfig is
 * missing or doesn't pass the type's Zod schema.
 *
 * Why a shared fallback: Opus generates the question + config in one
 * pass and occasionally produces malformed config for the more
 * complex types (scenario, matching, hotspot). Rather than blocking
 * the candidate on a placeholder "skip to continue" with no button,
 * we render a textarea so they can describe their answer in prose.
 * The rubric stored on the question still grades the text.
 */

import { useState } from "react";

import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

type Props = {
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
  hint?: string;
};

export function InvalidConfigTextFallback({
  onSubmit,
  disabled = false,
  hint = "Type your answer in your own words.",
}: Props) {
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const ready = text.trim().length >= 20;

  function handleSubmit() {
    if (disabled || submitted || !ready) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      textResponse: text.trim(),
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{hint}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={4000}
        disabled={disabled || submitted}
        placeholder="At least 20 characters."
        className="mt-3 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm"
        aria-label="Answer"
      />
      <div className="mt-2 flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span>{text.length} / 4000</span>
        <span>{ready ? "Ready" : `${20 - text.trim().length} more chars`}</span>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted || !ready}
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
