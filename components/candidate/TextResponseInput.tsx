"use client";

/**
 * TextResponseInput — fallback for open-ended questions when the candidate
 * prefers to type. Mirrors the VoiceRecorder shell (heading + "Record
 * instead" toggle) so the layout doesn't shift on switch.
 *
 * Exposes a `getTimeoutPayload` imperative handle: on per-question timeout
 * the parent calls this, and we submit the typed text ONLY if the candidate
 * cleared the same 20-char minimum that's enforced on manual submit. Below
 * the minimum, the timeout submits empty — same outcome as if they'd never
 * typed anything.
 */

import { forwardRef, useImperativeHandle, useState } from "react";

import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

const MIN_LENGTH = 20;
const MAX_LENGTH = 4000;

export type TextResponseInputHandle = {
  getTimeoutPayload: () => AnswerPayload;
};

export const TextResponseInput = forwardRef<
  TextResponseInputHandle,
  {
    onSubmit: (text: string) => void;
    onCancelToVoice: () => void;
    disabled?: boolean;
  }
>(function TextResponseInput({ onSubmit, onCancelToVoice, disabled = false }, ref) {
  const [text, setText] = useState("");

  const trimmed = text.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LENGTH;
  const overLimit = trimmed.length > MAX_LENGTH;
  const canSubmit = !disabled && trimmed.length >= MIN_LENGTH && !overLimit;

  useImperativeHandle(
    ref,
    () => ({
      getTimeoutPayload: (): AnswerPayload => {
        if (trimmed.length >= MIN_LENGTH && !overLimit) {
          return { selectedOptions: [], textResponse: trimmed };
        }
        return { selectedOptions: [] };
      },
    }),
    [trimmed, overLimit],
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        // Paste counter — fire-and-forget so a slow / unreachable API
        // never delays the candidate's typing. Pasted text is still
        // saved; this is observability only.
        onPaste={() => {
          void fetch("/api/sessions/signal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "paste" }),
            keepalive: true,
          }).catch(() => {});
        }}
        disabled={disabled}
        rows={5}
        maxLength={MAX_LENGTH + 50}
        placeholder="Write your answer here…"
        className={cn(
          // text-base (16 px) avoids iOS Safari focus-zoom; sm:text-sm
          // tightens on tablet+ for line economy.
          "mt-3 w-full resize-y rounded-xl border border-input bg-background p-3 text-base leading-relaxed sm:text-sm",
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
});
