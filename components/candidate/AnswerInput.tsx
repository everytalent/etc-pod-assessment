/**
 * Answer input — branches by question type.
 *
 *   mcq | true_false : option buttons (Phase 1 — optimistic highlight)
 *   open            : voice recorder by default, "Type instead" toggles to textarea
 *   other           : "not available" placeholder (file_upload, formula reserved)
 *
 * onSubmit takes the full AnswerPayload — caller (ChatShell) just forwards
 * to the Zustand store.
 */

"use client";

import { useState } from "react";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

import { TextResponseInput } from "./TextResponseInput";
import { VoiceRecorder } from "./VoiceRecorder";

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function AnswerInput({ question, onSubmit, disabled = false }: Props) {
  if (question.type === "mcq" || question.type === "true_false") {
    return (
      <McqAnswerInput
        question={question}
        onSubmit={onSubmit}
        disabled={disabled}
      />
    );
  }

  if (question.type === "open") {
    return (
      <OpenEndedAnswerInput
        question={question}
        onSubmit={onSubmit}
        disabled={disabled}
      />
    );
  }

  return (
    <div className="rounded-xl border border-dashed bg-card p-4 text-xs text-muted-foreground">
      This question type isn&rsquo;t available yet. Skip to continue.
    </div>
  );
}

/* ---------- MCQ / T-F ---------- */

function McqAnswerInput({ question, onSubmit, disabled }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  const handleClick = (id: string) => {
    if (disabled || picked !== null) return;
    setPicked(id);
    onSubmit({ selectedOptions: [id] });
  };

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

/* ---------- Open-ended (voice default, text fallback) ---------- */

type Mode = "voice" | "text";

function OpenEndedAnswerInput({ question, onSubmit, disabled }: Props) {
  // Voice is the default per spec; toggle to text if candidate prefers / can't record.
  const [mode, setMode] = useState<Mode>("voice");

  if (mode === "voice") {
    return (
      <VoiceRecorder
        questionId={question.id}
        disabled={disabled}
        onCancelToText={() => setMode("text")}
        onUploaded={(result) => {
          onSubmit({
            selectedOptions: [],
            audioPath: result.audioPath,
            audioDurationSeconds: result.durationSeconds,
          });
        }}
      />
    );
  }

  return (
    <TextResponseInput
      disabled={disabled}
      onCancelToVoice={() => setMode("voice")}
      onSubmit={(text) => {
        onSubmit({
          selectedOptions: [],
          textResponse: text,
        });
      }}
    />
  );
}
