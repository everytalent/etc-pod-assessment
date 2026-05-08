/**
 * Answer input — MCQ + T/F (Phase 1).
 *
 * Optimistic UI: the tapped option highlights instantly (sets local `picked`
 * state), then calls onSubmit which fires the API request via the Zustand
 * store. While the request is in flight (`disabled=true`), the buttons are
 * inert. PRD §6: 44px min touch target, 8px gap, marigold accent on selection.
 */

"use client";

import { useState } from "react";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import { cn } from "@/lib/utils";

type Props = {
  question: CandidateQuestion;
  onSubmit: (selectedOptions: string[]) => void;
  disabled?: boolean;
};

export function AnswerInput({ question, onSubmit, disabled = false }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  const handleClick = (id: string) => {
    if (disabled || picked !== null) return;
    setPicked(id);
    onSubmit([id]);
  };

  // Phase 1 supports MCQ + T/F (which we render as styled MCQ when the
  // question carries `[true, false]` options). Other types are scaffolded in
  // the data model but the UI hides them.
  if (question.type !== "mcq" && question.type !== "true_false") {
    return (
      <div className="rounded-xl border border-dashed bg-card p-4 text-xs text-muted-foreground">
        This question type isn&rsquo;t available yet. Skip to continue.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {question.options.map((opt) => {
        const isPicked = picked === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled || picked !== null}
            onClick={() => handleClick(opt.id)}
            className={cn(
              "min-h-11 rounded-xl border px-4 py-3 text-left text-sm leading-snug transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed",
              isPicked
                ? "border-etc-marigold bg-etc-marigold font-semibold text-etc-black"
                : "border-border bg-card text-etc-black hover:border-etc-marigold",
              !isPicked && (disabled || picked !== null) && "opacity-60",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
