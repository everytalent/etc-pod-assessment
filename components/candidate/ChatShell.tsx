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
import { useCandidateSession } from "@/lib/state/candidate-session";

import { AnswerInput } from "./AnswerInput";
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
    });
  }, [init, initial.responseId, initial.slug, initial.question, initial.score]);

  useEffect(() => {
    if (isComplete) {
      router.push(`/assess/${initial.slug}/done`);
    }
  }, [isComplete, router, initial.slug]);

  // Total may be wrong (branching), so progress denominator is max(total,
  // history+1) — always at least one step ahead of the answered count.
  const denom = Math.max(initial.totalQuestions, history.length + 1);
  const onTimeout = () => {
    if (isSubmitting) return;
    void submitAnswer([]);
  };
  const onPick = (selected: string[]) => {
    if (isSubmitting) return;
    void submitAnswer(selected);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
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
            key={`input-${currentQuestion.id}`}
            question={currentQuestion}
            onSubmit={onPick}
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
