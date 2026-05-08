"use client";

/**
 * Inline form for the assessment metadata (title, slug, status, threshold,
 * intro/outro). PATCH /api/admin/assessments/[id] on save; the parent
 * builder swaps the row in local state.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  upsertAssessmentSchema,
  type UpsertAssessmentInput,
} from "@/lib/admin/validators";
import type { Assessment } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

import { FieldRow, fieldInputClass } from "./form-fields";

type Props = {
  assessment: Assessment;
  onSaved: (next: Assessment) => void;
};

export function AssessmentForm({ assessment, onSaved }: Props) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<UpsertAssessmentInput>({
    resolver: zodResolver(upsertAssessmentSchema),
    defaultValues: {
      title: assessment.title,
      slug: assessment.slug,
      roleType: assessment.roleType,
      status: assessment.status,
      passThreshold: assessment.passThreshold,
      introText: assessment.introText,
      outroText: assessment.outroText,
    },
  });

  const onSubmit = async (values: UpsertAssessmentInput) => {
    setServerError(null);
    try {
      const res = await fetch(`/api/admin/assessments/${assessment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      const data = (await res.json()) as { assessment: Assessment };
      onSaved(data.assessment);
      reset(values);
      setHasSaved(true);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4 rounded-2xl border border-border bg-card p-5"
    >
      <FieldRow label="Title" error={errors.title?.message}>
        <input type="text" {...register("title")} className={fieldInputClass} />
      </FieldRow>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldRow label="URL slug" error={errors.slug?.message}>
          <input type="text" {...register("slug")} className={fieldInputClass} />
        </FieldRow>
        <FieldRow label="Pass threshold (%)" error={errors.passThreshold?.message}>
          <input
            type="number"
            min={0}
            max={100}
            {...register("passThreshold", { valueAsNumber: true })}
            className={fieldInputClass}
          />
        </FieldRow>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldRow label="Track" error={errors.roleType?.message}>
          <select {...register("roleType")} className={fieldInputClass}>
            <option value="tech">Solar Tech</option>
            <option value="bd">Business Development</option>
          </select>
        </FieldRow>
        <FieldRow label="Status" error={errors.status?.message}>
          <select {...register("status")} className={fieldInputClass}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </FieldRow>
      </div>

      <FieldRow label="Intro text" error={errors.introText?.message}>
        <textarea
          rows={2}
          {...register("introText")}
          className={cn(fieldInputClass, "h-auto py-2")}
        />
      </FieldRow>
      <FieldRow label="Outro text" error={errors.outroText?.message}>
        <textarea
          rows={2}
          {...register("outroText")}
          className={cn(fieldInputClass, "h-auto py-2")}
        />
      </FieldRow>

      {serverError && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {serverError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {hasSaved && !isDirty && (
          <span className="text-xs text-muted-foreground">Saved.</span>
        )}
        <button
          type="submit"
          disabled={isSubmitting || !isDirty}
          className="inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
