"use client";

/**
 * Top-level builder UI. Owns local state for the assessment + questions +
 * rules, persists every mutation via the admin API, and uses router.refresh()
 * after writes that touch derived server data (so the preview link reflects
 * the latest slug, etc).
 *
 * Drag-to-reorder is per-question, via @dnd-kit/sortable. On drop, the new
 * order is sent to /api/admin/questions/reorder atomically.
 */

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AssessmentForm } from "./AssessmentForm";
import { QuestionEditorModal } from "./QuestionEditorModal";
import { SortableQuestionCard } from "./SortableQuestionCard";

import type {
  Assessment,
  BranchingRule,
  Question,
} from "@/lib/db/schema";

type Props = {
  initial: {
    assessment: Assessment;
    questions: Question[];
    rules: BranchingRule[];
  };
};

export function AssessmentBuilder({ initial }: Props) {
  const router = useRouter();
  const [assessment, setAssessment] = useState<Assessment>(initial.assessment);
  const [questions, setQuestions] = useState<Question[]>(initial.questions);
  const [rules, setRules] = useState<BranchingRule[]>(initial.rules);
  const [editingQuestion, setEditingQuestion] = useState<
    Question | "new" | null
  >(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = questions.findIndex((q) => q.id === active.id);
    const newIdx = questions.findIndex((q) => q.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(questions, oldIdx, newIdx).map((q, i) => ({
      ...q,
      orderIndex: i,
    }));
    setQuestions(next);
    setReorderError(null);
    try {
      const res = await fetch("/api/admin/questions/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: assessment.id,
          orderedIds: next.map((q) => q.id),
        }),
      });
      if (!res.ok) {
        throw new Error(`reorder failed: ${res.status}`);
      }
    } catch (err) {
      setReorderError(err instanceof Error ? err.message : "Reorder failed");
      // Revert local state — refresh from server.
      router.refresh();
    }
  };

  const handleQuestionSaved = (saved: Question) => {
    setQuestions((prev) => {
      const i = prev.findIndex((q) => q.id === saved.id);
      if (i === -1) return [...prev, saved];
      const next = [...prev];
      next[i] = saved;
      return next;
    });
    setEditingQuestion(null);
    router.refresh();
  };

  const handleQuestionDeleted = async (id: string) => {
    if (!confirm("Delete this question? This also removes its rules and answers.")) return;
    const res = await fetch(`/api/admin/questions/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`Delete failed: ${res.status}`);
      return;
    }
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    setRules((prev) => prev.filter((r) => r.fromQuestionId !== id));
    router.refresh();
  };

  const handleRulesChanged = (next: BranchingRule[]) => setRules(next);

  const onDeleteAssessment = async () => {
    if (
      !confirm(
        `Delete the assessment "${assessment.title}"? This cascades to questions, branching rules, and all candidate responses + answers. Cannot be undone.`,
      )
    ) {
      return;
    }
    if (
      !confirm(
        "One more confirmation — type the slug to delete is the next step in a more careful flow. For now: this is your last chance. Continue?",
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/assessments/${assessment.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      router.push("/admin");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Edit assessment
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            {assessment.title}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            /{assessment.slug}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/assessments/${assessment.id}/responses`}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
          >
            View responses
          </Link>
          <Link
            href={`/assess/${assessment.slug}?preview=true`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
          >
            Preview ↗
          </Link>
          <button
            type="button"
            onClick={() => void onDeleteAssessment()}
            className="inline-flex h-10 items-center rounded-xl border border-border bg-background px-4 text-sm font-medium text-destructive hover:border-destructive"
          >
            Delete assessment
          </button>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Settings
        </h2>
        <AssessmentForm
          assessment={assessment}
          onSaved={(saved) => setAssessment(saved)}
        />
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Questions ({questions.length})
          </h2>
          <button
            type="button"
            onClick={() => setEditingQuestion("new")}
            className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            + Add question
          </button>
        </div>

        {reorderError && (
          <p className="mb-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {reorderError}
          </p>
        )}

        {questions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
            No questions yet. Click <span className="font-medium">Add question</span>.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={questions.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-3">
                {questions.map((q, i) => (
                  <SortableQuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    questions={questions}
                    rules={rules.filter((r) => r.fromQuestionId === q.id)}
                    assessmentId={assessment.id}
                    onEdit={() => setEditingQuestion(q)}
                    onDelete={() => void handleQuestionDeleted(q.id)}
                    onRulesChanged={handleRulesChanged}
                    allRules={rules}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {editingQuestion && (
        <QuestionEditorModal
          assessmentId={assessment.id}
          question={editingQuestion === "new" ? null : editingQuestion}
          onClose={() => setEditingQuestion(null)}
          onSaved={handleQuestionSaved}
        />
      )}
    </>
  );
}
