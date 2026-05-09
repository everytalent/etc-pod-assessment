"use client";

/**
 * TextResponseInput — fallback for open-ended questions when the candidate
 * prefers to type. Mirrors the VoiceRecorder shell (heading + "Record
 * instead" toggle) so the layout doesn't shift on switch.
 */

import { useState } from "react";

import { cn } from "@/lib/utils";

const MIN_LENGTH = 20;
const MAX_LENGTH = 4000;

export function TextResponseInput({
  onSubmit,
  onCancelToVoice,
  disabled = false,
}: {
  onSubmit: (text: string) => void;
  onCancelToVoice: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  const trimmed = text.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LENGTH;
  const overLimit = trimmed.length > MAX_LENGTH;
  const canSubmit = !disabled && trimmed.length >= MIN_LENGTH && !overLimit;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Type your answer
        </p>
        <button
          type="button"
          onClick={onCancelToVoice}
          disabled={disabled}
          className="text-[0.7rem] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Record instead
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        rows={5}
        maxLength={MAX_LENGTH + 50}
        placeholder="Write your answer here…"
        className={cn(
          "mt-3 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm leading-relaxed",
          "focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
      />

      <div className="mt-2 flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span>
          {tooShort
            ? `Min ${MIN_LENGTH} characters (${trimmed.length}/${MIN_LENGTH})`
            : overLimit
              ? `Over the ${MAX_LENGTH}-char limit`
              : `${trimmed.length} characters`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onSubmit(trimmed)}
        disabled={!canSubmit}
        className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Submit answer
      </button>
    </div>
  );
}
