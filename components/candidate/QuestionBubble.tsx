/**
 * Animated question bubble — PRD §5.1 step 5 ("slides in from below, 300ms
 * ease-out") and step 9 ("Question bubble locks, greyed").
 *
 * Two visual states:
 *   - active   : white card, soft shadow, optional Timer chip
 *   - locked   : muted background, no timer (already answered)
 */

"use client";

import { motion } from "framer-motion";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import { cn } from "@/lib/utils";

import { Timer } from "./Timer";

const slideIn = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  transition: { duration: 0.3, ease: "easeOut" as const },
};

export function ActiveQuestionBubble({
  question,
  onTimeout,
}: {
  question: CandidateQuestion;
  onTimeout: () => void;
}) {
  const showTimer =
    question.timerEnabled && typeof question.timeLimitSeconds === "number";

  return (
    <motion.div
      {...slideIn}
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      {question.section && (
        <p className="mb-2 text-[0.68rem] font-medium uppercase tracking-[0.15em] text-muted-foreground">
          {question.section}
        </p>
      )}
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-base leading-relaxed text-foreground sm:text-sm">
          {question.questionText}
        </p>
        {showTimer && (
          <Timer
            limitSeconds={question.timeLimitSeconds!}
            onTimeout={onTimeout}
          />
        )}
      </div>
      {question.negativePoints > 0 && (
        <p className="mt-3 text-[0.68rem] text-muted-foreground">
          {question.points} pts · wrong answer subtracts {question.negativePoints}
        </p>
      )}
    </motion.div>
  );
}

export function LockedQuestionBubble({
  questionText,
  selectedLabel,
}: {
  questionText: string;
  selectedLabel: string | null;
}) {
  return (
    <motion.div
      {...slideIn}
      className={cn(
        "rounded-2xl border border-border bg-muted p-4",
        "text-sm text-muted-foreground",
      )}
    >
      <p className="break-words leading-relaxed">{questionText}</p>
      {selectedLabel && (
        <p className="mt-2 break-words text-xs font-medium text-foreground/70">
          You answered: <span className="text-foreground">{selectedLabel}</span>
        </p>
      )}
    </motion.div>
  );
}
