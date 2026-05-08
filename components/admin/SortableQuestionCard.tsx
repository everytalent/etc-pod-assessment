"use client";

/**
 * One row in the builder question list. Wraps the dnd-kit sortable hook,
 * exposes summary metadata, edit/delete actions, and inline branching rule
 * editor underneath (collapsed by default).
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";

import type { BranchingRule, Question } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { BranchingRuleEditor } from "./BranchingRuleEditor";

type Props = {
  question: Question;
  index: number;
  questions: Question[];
  rules: BranchingRule[];
  allRules: BranchingRule[];
  assessmentId: string;
  onEdit: () => void;
  onDelete: () => void;
  onRulesChanged: (next: BranchingRule[]) => void;
};

export function SortableQuestionCard({
  question,
  index,
  questions,
  rules,
  allRules,
  assessmentId,
  onEdit,
  onDelete,
  onRulesChanged,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });
  const [showRules, setShowRules] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-2xl border border-border bg-card p-4",
        isDragging && "ring-2 ring-etc-marigold",
      )}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          aria-label="Drag to reorder"
          className="flex h-9 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          ⋮⋮
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-mono uppercase text-muted-foreground">
              #{index + 1}
            </span>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              {question.type}
            </span>
            {question.timerEnabled && question.timeLimitSeconds && (
              <span className="rounded-md border border-etc-marigold bg-etc-marigold/15 px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-etc-black">
                {question.timeLimitSeconds}s
              </span>
            )}
            {question.section && (
              <span className="rounded-md border border-border px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                {question.section}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {question.questionText}
          </p>
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            {question.points} pts
            {question.negativePoints > 0 ? ` · −${question.negativePoints} on wrong` : ""}
            {question.options.length > 0 ? ` · ${question.options.length} options` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2 text-[0.7rem] hover:border-etc-marigold"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-7 items-center rounded-lg border border-border bg-background px-2 text-[0.7rem] text-destructive hover:border-destructive"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {showRules ? "▾" : "▸"} Branching rules ({rules.length})
        </button>
        {showRules && (
          <div className="mt-3">
            <BranchingRuleEditor
              assessmentId={assessmentId}
              fromQuestion={question}
              questions={questions}
              rules={rules}
              allRules={allRules}
              onRulesChanged={onRulesChanged}
            />
          </div>
        )}
      </div>
    </li>
  );
}
