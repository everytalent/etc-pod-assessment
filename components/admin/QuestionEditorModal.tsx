"use client";

/**
 * Question editor — modal with conditional fields:
 *   - timer fields (limit + action) reveal only when `timerEnabled` is on
 *   - options + correct_answer editable inline for MCQ / true_false
 *
 * Persists via POST or PATCH to the admin API based on whether `question`
 * is null (new) or an existing row.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";

import {
  upsertQuestionSchema,
  type UpsertQuestionInput,
} from "@/lib/admin/validators";
import type { Question } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { FieldRow, fieldInputClass, Toggle } from "./form-fields";

type Props = {
  assessmentId: string;
  question: Question | null;
  onClose: () => void;
  onSaved: (saved: Question) => void;
};

// Phase 2: only the three types we actually render in the candidate UI.
// `voice`, `file`, `formula` remain in the schema enum for forward-compat
// but the admin dropdown hides them.
const QUESTION_TYPES: UpsertQuestionInput["type"][] = [
  "mcq",
  "true_false",
  "open",
];

const TYPE_LABELS: Record<UpsertQuestionInput["type"], string> = {
  mcq: "Multiple choice",
  true_false: "True / False",
  open: "Open-ended (voice or text)",
  voice: "voice (legacy)",
  file: "file (legacy)",
  formula: "formula (legacy)",
};

const TIMEOUT_ACTIONS: UpsertQuestionInput["timeoutAction"][] = [
  "auto_submit",
  "skip",
  "mark_incorrect",
];

export function QuestionEditorModal({
  assessmentId,
  question,
  onClose,
  onSaved,
}: Props) {
  const isNew = question === null;
  const [serverError, setServerError] = useState<string | null>(null);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreResult, setRescoreResult] = useState<string | null>(null);
  const rescoreSupported =
    !isNew && question && question.type !== "open" && question.type !== "voice";

  const rescore = async () => {
    if (isNew || !question) return;
    if (
      !confirm(
        "Re-run scoring on every existing answer to this question using the current correctAnswer / points? Affected responses' totals (and pass/fail) will update.",
      )
    ) {
      return;
    }
    setRescoring(true);
    setRescoreResult(null);
    setServerError(null);
    try {
      const res = await fetch(
        `/api/admin/questions/${question.id}/rescore`,
        { method: "POST" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        examined?: number;
        updated?: number;
        responses_recomputed?: number;
        message?: string;
      };
      if (!res.ok) {
        throw new Error(data.message ?? `Rescore failed (${res.status})`);
      }
      setRescoreResult(
        `Examined ${data.examined ?? 0}, updated ${data.updated ?? 0}, recomputed ${
          data.responses_recomputed ?? 0
        } response(s).`,
      );
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Rescore failed");
    } finally {
      setRescoring(false);
    }
  };

  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UpsertQuestionInput>({
    resolver: zodResolver(upsertQuestionSchema),
    defaultValues: question
      ? {
          type: question.type,
          questionText: question.questionText,
          options: question.options,
          correctAnswer: question.correctAnswer,
          points: question.points,
          negativePoints: question.negativePoints,
          timerEnabled: question.timerEnabled,
          timeLimitSeconds: question.timeLimitSeconds,
          timeoutAction: question.timeoutAction,
          required: question.required,
          section: question.section,
          scoringRubric: question.scoringRubric,
        }
      : {
          type: "mcq",
          questionText: "",
          options: [
            { id: "a", label: "" },
            { id: "b", label: "" },
          ],
          correctAnswer: [],
          points: 1,
          negativePoints: 0,
          timerEnabled: false,
          timeLimitSeconds: null,
          timeoutAction: "auto_submit",
          required: true,
          section: null,
          scoringRubric: null,
        },
  });

  // keyName: useFieldArray's default ("id") collides with our own option `id`
  // — RHF would overwrite it with a synthetic key, so the radio's `field.id`
  // would no longer match the option id stored in form state, and
  // correctAnswer would reference a phantom uuid the validator can't find.
  // "rhfKey" parks the synthetic key elsewhere; field.id stays the real one.
  const { fields, append, remove } = useFieldArray({
    control,
    name: "options",
    keyName: "rhfKey",
  });

  // useWatch is the memoizable hook variant; `watch()` returns a non-stable
  // function and React Compiler warns when the result is used in render.
  const timerEnabled = useWatch({ control, name: "timerEnabled" });
  const type = useWatch({ control, name: "type" });
  const correctAnswer = useWatch({ control, name: "correctAnswer" });

  // When timer toggles off, blank the limit so the schema validation passes.
  // `getValues` is a stable getter (snapshot) — unlike `watch`, it doesn't
  // subscribe and is safe to call inside an effect.
  useEffect(() => {
    if (!timerEnabled) setValue("timeLimitSeconds", null);
    else if (timerEnabled && getValues("timeLimitSeconds") === null) {
      setValue("timeLimitSeconds", 30);
    }
  }, [timerEnabled, setValue, getValues]);

  // Switching to open clears the option-related fields (they're hidden
  // and unused for open-ended). negativePoints stays — the admin uses it
  // during manual scoring to set the lower bound on awardable points.
  useEffect(() => {
    if (type === "open") {
      if (getValues("options").length !== 0) setValue("options", []);
      if (getValues("correctAnswer").length !== 0) setValue("correctAnswer", []);
    }
  }, [type, setValue, getValues]);

  const onSubmit = async (values: UpsertQuestionInput) => {
    setServerError(null);
    try {
      const url = isNew
        ? `/api/admin/assessments/${assessmentId}/questions`
        : `/api/admin/questions/${question!.id}`;
      const res = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Save failed (${res.status})`);
      }
      const data = (await res.json()) as { question: Question };
      onSaved(data.question);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const toggleCorrect = (id: string) => {
    const current = correctAnswer ?? [];
    if (type === "mcq" || type === "true_false") {
      // Single-select for MCQ in Phase 1 — radio behaviour.
      setValue("correctAnswer", current.includes(id) ? [] : [id], {
        shouldDirty: true,
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Question
            </p>
            <h2 className="mt-1 text-xl font-bold">
              {isNew ? "New question" : "Edit question"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:border-etc-marigold"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="mt-5 grid gap-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow label="Type" error={errors.type?.message}>
              <select {...register("type")} className={fieldInputClass}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Section (optional)" error={errors.section?.message}>
              <input
                type="text"
                {...register("section", {
                  setValueAs: (v) => (typeof v === "string" && v.trim() === "" ? null : v),
                })}
                className={fieldInputClass}
                placeholder="e.g. safety"
              />
            </FieldRow>
          </div>

          <FieldRow label="Question text" error={errors.questionText?.message}>
            <textarea
              rows={2}
              {...register("questionText")}
              className={cn(fieldInputClass, "h-auto py-2")}
            />
          </FieldRow>

          {type === "open" && (
            <>
              <div className="rounded-xl border border-dashed border-etc-marigold bg-etc-marigold/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-etc-black">
                  Open-ended
                </p>
                <p className="mt-2 text-xs text-foreground">
                  Candidate sees a voice recorder by default with a &ldquo;Type
                  instead&rdquo; toggle. Reviewers can transcribe the audio
                  with Gemini, then click <strong>Suggest score</strong> to
                  get an AI-suggested score that uses the rubric below.
                  Reviewers always have final say.
                </p>
              </div>
              <FieldRow
                label="Scoring rubric (for AI auto-score)"
                hint='Free-form. List "required keywords", "preferred keywords", "red-flag keywords", "must hit N" rules, and any domain notes. The AI is instructed to extend with general engineering knowledge — paraphrases of required concepts get credit.'
                error={errors.scoringRubric?.message}
              >
                <textarea
                  rows={8}
                  {...register("scoringRubric", {
                    setValueAs: (v) =>
                      typeof v === "string" && v.trim() === "" ? null : v,
                  })}
                  className={cn(fieldInputClass, "h-auto py-2 font-mono text-xs")}
                  placeholder={`Required (must hit 3):
- Earth resistance tester
- Earth continuity test
- Less than 5 ohms

Red flags:
- "Use multimeter only"`}
                />
              </FieldRow>
            </>
          )}

          {(type === "mcq" || type === "true_false") && (
            <div className="rounded-xl border border-dashed border-border bg-background/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Options
              </p>
              {errors.options?.message && (
                <p className="mt-1 text-[0.7rem] text-destructive">
                  {errors.options.message}
                </p>
              )}
              <ul className="mt-2 flex flex-col gap-2">
                {fields.map((field, i) => (
                  <li key={field.rhfKey} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correctRadio"
                      checked={correctAnswer?.includes(field.id) ?? false}
                      onChange={() => toggleCorrect(field.id)}
                      className="h-4 w-4 accent-etc-marigold"
                      aria-label={`Mark option ${field.id} correct`}
                    />
                    <input
                      type="text"
                      placeholder={`Option ${field.id}`}
                      {...register(`options.${i}.label` as const)}
                      className={cn(fieldInputClass, "flex-1")}
                    />
                    <input
                      type="text"
                      {...register(`options.${i}.id` as const)}
                      className={cn(fieldInputClass, "w-14 text-center")}
                      aria-label="Option id"
                    />
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs hover:border-destructive"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() =>
                  append({
                    id: String.fromCharCode(97 + fields.length),
                    label: "",
                  })
                }
                className="mt-3 inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold"
              >
                + Add option
              </button>
              {errors.correctAnswer?.message && (
                <p className="mt-2 text-[0.7rem] text-destructive">
                  {errors.correctAnswer.message}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <FieldRow
              label={type === "open" ? "Max points (you award during review)" : "Points"}
              hint={type === "open" ? "Highest score you can give this answer." : undefined}
              error={errors.points?.message}
            >
              <input
                type="number"
                min={0}
                {...register("points", { valueAsNumber: true })}
                className={fieldInputClass}
              />
            </FieldRow>
            <FieldRow
              label="Deduction on wrong (points)"
              hint={
                type === "open"
                  ? "Positive number. Subtracted if you score this answer as wrong during review."
                  : "Positive number — subtracted on a wrong answer."
              }
              error={errors.negativePoints?.message}
            >
              <input
                type="number"
                min={0}
                {...register("negativePoints", { valueAsNumber: true })}
                className={fieldInputClass}
              />
            </FieldRow>
          </div>

          <div className="rounded-xl border border-border bg-background/40 p-4">
            <Controller
              control={control}
              name="timerEnabled"
              render={({ field }) => (
                <Toggle
                  checked={field.value}
                  onChange={field.onChange}
                  label="Timed question"
                />
              )}
            />
            {timerEnabled && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <FieldRow
                  label="Time limit (seconds)"
                  error={errors.timeLimitSeconds?.message}
                >
                  <input
                    type="number"
                    min={1}
                    {...register("timeLimitSeconds", { valueAsNumber: true })}
                    className={fieldInputClass}
                  />
                </FieldRow>
                <FieldRow
                  label="On timeout"
                  error={errors.timeoutAction?.message}
                >
                  <select
                    {...register("timeoutAction")}
                    className={fieldInputClass}
                  >
                    {TIMEOUT_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </div>
            )}
          </div>

          <Controller
            control={control}
            name="required"
            render={({ field }) => (
              <Toggle
                checked={field.value}
                onChange={field.onChange}
                label="Required (cannot skip)"
              />
            )}
          />

          {serverError && (
            <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {serverError}
            </p>
          )}

          {rescoreResult && (
            <p className="rounded-lg border border-etc-marigold bg-etc-marigold/10 p-3 text-xs text-etc-black">
              {rescoreResult}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            {rescoreSupported ? (
              <button
                type="button"
                onClick={() => void rescore()}
                disabled={rescoring || isSubmitting}
                className="inline-flex h-9 items-center rounded-xl border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-60"
                title="Re-run scoring on every existing answer using the current correctAnswer / points."
              >
                {rescoring ? "Rescoring…" : "Rescore all responses"}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-xl border border-border bg-background px-4 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {isSubmitting ? "Saving…" : isNew ? "Create" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
