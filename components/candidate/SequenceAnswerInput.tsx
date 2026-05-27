"use client";

/**
 * SequenceAnswerInput — drag-and-drop ordering, Phase 2 question type.
 *
 * Reads `items[]` from question.interactiveConfig (presentation order;
 * authors typically shuffle them so the displayed order doesn't already
 * answer the question). The candidate drags to reorder, then submits.
 *
 * On submit emits AnswerPayload.structuredAnswer = { sequence: [id, …] }.
 *
 * Scoring is deterministic via the type registry — either exact-match
 * or Kendall-tau partial credit, depending on the question config.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import { z } from "zod";

import type { CandidateQuestion } from "@/lib/assessment/validators";
import type { AnswerPayload } from "@/lib/state/candidate-session";
import { cn } from "@/lib/utils";

const sequenceConfigSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
      }),
    )
    .min(2),
});

type Props = {
  question: CandidateQuestion;
  onSubmit: (payload: AnswerPayload) => void;
  disabled?: boolean;
};

export function SequenceAnswerInput({ question, onSubmit, disabled = false }: Props) {
  const parsed = useMemo(() => {
    const result = sequenceConfigSchema.safeParse(question.interactiveConfig);
    return result.success ? result.data : null;
  }, [question.interactiveConfig]);

  // Local order — initial = presentation order from the config.
  const [order, setOrder] = useState<{ id: string; label: string }[]>(
    () => parsed?.items ?? [],
  );
  const [submitted, setSubmitted] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (!parsed) {
    return (
      <div className="rounded-2xl border border-destructive bg-destructive/10 p-4 text-xs text-destructive">
        This sequence question has an invalid configuration. Skip to continue.
      </div>
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((items) => {
      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  }

  function handleSubmit() {
    if (disabled || submitted) return;
    setSubmitted(true);
    onSubmit({
      selectedOptions: [],
      structuredAnswer: { sequence: order.map((i) => i.id) },
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Drag to reorder
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={order.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="mt-3 flex flex-col gap-2">
            {order.map((item, index) => (
              <SequenceRow
                key={item.id}
                id={item.id}
                index={index}
                label={item.label}
                disabled={disabled || submitted}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || submitted}
        className={cn(
          "mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
          "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {submitted ? "Submitted…" : "Submit order"}
      </button>
    </div>
  );
}

function SequenceRow({
  id,
  index,
  label,
  disabled,
}: {
  id: string;
  index: number;
  label: string;
  disabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5",
        !disabled && "cursor-grab active:cursor-grabbing hover:border-etc-marigold",
      )}
      {...attributes}
      {...listeners}
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold tabular-nums text-muted-foreground"
      >
        {index + 1}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      {!disabled && (
        <span aria-hidden className="text-lg text-muted-foreground">
          ⠿
        </span>
      )}
    </li>
  );
}
