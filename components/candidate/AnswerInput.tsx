/**
 * Answer input — branches by question type.
 *
 *   mcq | true_false : option buttons (Phase 1 — optimistic highlight)
 *   open            : voice recorder by default, "Type instead" toggles to textarea
 *   other           : "not available" placeholder (file_upload, formula reserved)
 *
 * onSubmit takes the full AnswerPayload — caller (ChatShell) just forwards
 * to the Zustand store.
 *
 * Exposes `getTimeoutPayload()` via a ref so ChatShell can capture whatever
 * the candidate has at the moment their per-question timer fires:
 *   - MCQ: empty (click-to-submit already fired if they picked anything)
 *   - Text: typed text iff it cleared the 20-char minimum
 *   - Voice: stop + upload current recording; flag recordingAttempted if
 *     the upload fails or there are no bytes
 */

"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

import {
  TextResponseInput,
  type TextResponseInputHandle,
} from "./TextResponseInput";
import { HotspotAnswerInput } from "./HotspotAnswerInput";
import { MatchingAnswerInput } from "./MatchingAnswerInput";
import { ScenarioAnswerInput } from "./ScenarioAnswerInput";
import { FileAnswerInput } from "./FileAnswerInput";
import { FormulaAnswerInput } from "./FormulaAnswerInput";
import { SequenceAnswerInput } from "./SequenceAnswerInput";
import { SliderAnswerInput } from "./SliderAnswerInput";
import { VoiceRecorder, type VoiceRecorderHandle } from "./VoiceRecorder";

export type AnswerInputHandle = {
  /** Resolve with the best payload we can produce for a timeout submit. */
  getTimeoutPayload: () => Promise<AnswerPayload>;
};

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export const AnswerInput = forwardRef<AnswerInputHandle, Props>(
  function AnswerInput({ question, onSubmit, disabled = false }, ref) {
    const openRef = useRef<OpenEndedAnswerInputHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        getTimeoutPayload: async (): Promise<AnswerPayload> => {
          if (question.type === "open" && openRef.current) {
            return openRef.current.getTimeoutPayload();
          }
          // MCQ / true_false / unsupported types: timeout always sends empty.
          // (Click-to-submit means a chosen option is already on its way.)
          return { selectedOptions: [] };
        },
      }),
      [question.type],
    );

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
          ref={openRef}
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "slider") {
      return (
        <SliderAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "sequence") {
      return (
        <SequenceAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "matching") {
      return (
        <MatchingAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "hotspot") {
      return (
        <HotspotAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "scenario") {
      return (
        <ScenarioAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "formula") {
      return (
        <FormulaAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    if (question.type === "file") {
      return (
        <FileAnswerInput
          question={question}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    }

    // Voice falls through to the open-ended input — OpenEndedAnswerInput
    // already supports voice via VoiceRecorder.
    if (question.type === "voice") {
      return (
        <OpenEndedAnswerInput
          ref={openRef}
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
  },
);

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
              // Desktop preserved: min-h-11 + text-sm. Mobile gets a
              // 16 px option label (text-base) so labels are easier to
              // tap-and-read on a phone and iOS Safari won't focus-zoom
              // when these become focusable. touch-manipulation skips
              // the 300 ms tap delay on mobile browsers.
              "min-h-11 break-words rounded-xl border px-4 py-3 text-left text-base leading-snug transition-colors touch-manipulation sm:text-sm",
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

type OpenEndedAnswerInputHandle = {
  getTimeoutPayload: () => Promise<AnswerPayload>;
};

const OpenEndedAnswerInput = forwardRef<OpenEndedAnswerInputHandle, Props>(
  function OpenEndedAnswerInput({ question, onSubmit, disabled }, ref) {
    // Voice is the default per spec; toggle to text if candidate prefers / can't record.
    const [mode, setMode] = useState<Mode>("voice");
    const voiceRef = useRef<VoiceRecorderHandle>(null);
    const textRef = useRef<TextResponseInputHandle>(null);

    useImperativeHandle(
      ref,
      () => ({
        getTimeoutPayload: async (): Promise<AnswerPayload> => {
          if (mode === "voice" && voiceRef.current) {
            return voiceRef.current.flushOnTimeout();
          }
          if (mode === "text" && textRef.current) {
            return textRef.current.getTimeoutPayload();
          }
          return { selectedOptions: [] };
        },
      }),
      [mode],
    );

    if (mode === "voice") {
      return (
        <VoiceRecorder
          ref={voiceRef}
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
        ref={textRef}
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
  },
);
