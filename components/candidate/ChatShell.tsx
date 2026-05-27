/**
 * Conversational session shell. Owns nothing visual itself — orchestrates
 * the Zustand store, Timer auto-submit, and routing to /done on completion.
 *
 * Initial state is hydrated from a Server Component prop (PRD §9: "candidate
 * loses progress on refresh → resume from responses row keyed by session
 * cookie"), so the page survives a hard refresh without a client round-trip.
 */

"use client";

import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { ResumedHistoryEntry } from "@/lib/assessment/queries";
import { useCandidateSession } from "@/lib/state/candidate-session";

import { AnswerInput, type AnswerInputHandle } from "./AnswerInput";
import {
  ActiveQuestionBubble,
  LockedQuestionBubble,
} from "./QuestionBubble";
import { ProgressBar } from "./ProgressBar";

export type ChatShellInitial = {
  responseId: string;
  slug: string;
  question: CandidateQuestion | null;
  score: number;
  totalQuestions: number;
  history: ResumedHistoryEntry[];
};

export function ChatShell({ initial }: { initial: ChatShellInitial }) {
  const router = useRouter();
  const init = useCandidateSession((s) => s.init);
  const submitAnswer = useCandidateSession((s) => s.submitAnswer);
  const currentQuestion = useCandidateSession((s) => s.currentQuestion);
  const history = useCandidateSession((s) => s.history);
  const isComplete = useCandidateSession((s) => s.isComplete);
  const isSubmitting = useCandidateSession((s) => s.isSubmitting);
  const errorMessage = useCandidateSession((s) => s.errorMessage);

  const initialiseRef = useRef(false);
  useEffect(() => {
    if (initialiseRef.current) return;
    initialiseRef.current = true;
    init({
      responseId: initial.responseId,
      slug: initial.slug,
      question: initial.question,
      score: initial.score,
      history: initial.history,
    });
  }, [
    init,
    initial.responseId,
    initial.slug,
    initial.question,
    initial.score,
    initial.history,
  ]);

  useEffect(() => {
    if (isComplete) {
      router.push(`/assess/${initial.slug}/done`);
    }
  }, [isComplete, router, initial.slug]);

  // Tab-blur counter: fire whenever the page becomes hidden during the
  // assessment. Fire-and-forget POST so a flaky network never blocks the
  // candidate from continuing.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onHide = () => {
      if (document.hidden) {
        void fetch("/api/sessions/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "tab_blur" }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  // Total may be wrong (branching), so progress denominator is max(total,
  // history+1) — always at least one step ahead of the answered count.
  const denom = Math.max(initial.totalQuestions, history.length + 1);

  // AnswerInput exposes its current state through this ref so the timeout
  // path can capture whatever the candidate has — typed text past the min
  // length, an in-flight voice recording, etc. — before the question
  // auto-advances.
  const answerRef = useRef<AnswerInputHandle | null>(null);
  const onTimeout = () => {
    if (isSubmitting) return;
    void (async () => {
      const payload = answerRef.current
        ? await answerRef.current.getTimeoutPayload()
        : { selectedOptions: [] };
      // Re-check isSubmitting after the async hop — voice flush can take
      // a few seconds, and the candidate might have submitted manually
      // in the meantime.
      if (useCandidateSession.getState().isSubmitting) return;
      void submitAnswer(payload);
    })();
  };

  return (
    <main
      className={
        // Desktop is intentionally identical to before: max-w-md +
        // px-4 + py-6. The only additions are (a) w-full so the
        // container actually fills narrow screens before hitting the
        // 28-rem cap, and (b) iOS safe-area insets so notches and the
        // home-indicator don't eat into content on phones.
        "mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 py-6 " +
        "pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      }
    >
      <ProgressBar current={history.length} total={denom} />

      <div className="flex flex-1 flex-col gap-3">
        <AnimatePresence initial={false}>
          {history.map((entry) => (
            <LockedQuestionBubble
              key={`locked-${entry.questionId}`}
              questionText={entry.questionText}
              selectedLabel={entry.selectedLabel}
            />
          ))}
          {currentQuestion && (
            <ActiveQuestionBubble
              key={`active-${currentQuestion.id}`}
              question={currentQuestion}
              onTimeout={onTimeout}
            />
          )}
        </AnimatePresence>

        {currentQuestion && (
          <AnswerInput
            ref={answerRef}
            key={`input-${currentQuestion.id}`}
            question={currentQuestion}
            onSubmit={(payload) => {
              if (isSubmitting) return;
              void submitAnswer(payload);
            }}
            disabled={isSubmitting}
          />
        )}
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {errorMessage}
        </div>
      )}
    </main>
  );
}
