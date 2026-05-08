"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  upsertAssessmentSchema,
  type UpsertAssessmentInput,
} from "@/lib/admin/validators";
import { cn } from "@/lib/utils";

import { FieldRow, fieldInputClass } from "./form-fields";

export function NewAssessmentForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpsertAssessmentInput>({
    resolver: zodResolver(upsertAssessmentSchema),
    defaultValues: {
      title: "",
      slug: "",
      roleType: "tech",
      status: "draft",
      passThreshold: 70,
      introText: "",
      outroText: "",
    },
  });

  const onSubmit = async (values: UpsertAssessmentInput) => {
    setServerError(null);
    try {
      const res = await fetch("/api/admin/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      const data = (await res.json()) as { assessment: { id: string } };
      router.push(`/admin/assessments/${data.assessment.id}/edit`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4 rounded-2xl border border-border bg-card p-6"
    >
      <FieldRow label="Title" error={errors.title?.message}>
        <input type="text" {...register("title")} className={fieldInputClass} />
      </FieldRow>
      <FieldRow
        label="URL slug"
        error={errors.slug?.message}
        hint="lower-kebab — used in /assess/:slug"
      >
        <input type="text" {...register("slug")} className={fieldInputClass} />
      </FieldRow>
      <div className="grid grid-cols-2 gap-4">
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
      <FieldRow
        label="Pass threshold (%)"
        error={errors.passThreshold?.message}
      >
        <input
          type="number"
          min={0}
          max={100}
          {...register("passThreshold", { valueAsNumber: true })}
          className={fieldInputClass}
        />
      </FieldRow>
      <FieldRow label="Intro text" error={errors.introText?.message}>
        <textarea
          rows={3}
          {...register("introText")}
          className={cn(fieldInputClass, "h-auto py-2")}
        />
      </FieldRow>
      <FieldRow label="Outro text" error={errors.outroText?.message}>
        <textarea
          rows={3}
          {...register("outroText")}
          className={cn(fieldInputClass, "h-auto py-2")}
        />
      </FieldRow>
      {serverError && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {serverError}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {isSubmitting ? "Creating…" : "Create assessment"}
        </button>
      </div>
    </form>
  );
}
