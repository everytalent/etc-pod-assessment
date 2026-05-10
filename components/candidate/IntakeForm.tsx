/**
 * Candidate intake form — name / email / phone.
 *
 * On submit, POSTs to /api/sessions and routes to /assess/[slug]/session.
 * Validation mirrors the server-side Zod schema (startSessionSchema).
 *
 * Phase 1 deviation from the strict PRD wording: phone is optional. The
 * Drizzle schema makes candidate_phone nullable, so the form follows that.
 */

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { StartSessionResponse } from "@/lib/assessment/validators";
import { cn } from "@/lib/utils";

const intakeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(255),
  phone: z
    .string()
    .trim()
    .min(5, "Phone is too short")
    .max(40, "Phone is too long")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
type IntakeValues = z.infer<typeof intakeSchema>;

type Props = {
  slug: string;
  title: string;
  introText: string;
  estimatedMinutes: number;
};

export function IntakeForm({ slug, title, introText, estimatedMinutes }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<IntakeValues>({
    resolver: zodResolver(intakeSchema),
    defaultValues: { name: "", email: "", phone: "" },
  });

  // Preview mode marker — when ?preview=true is on the URL, set a 1-hour
  // cookie so the proxy allows candidate APIs on the admin host through
  // the rest of the preview walk. SameSite=Lax keeps it out of cross-site
  // requests; Secure (in prod via HTTPS) protects in-transit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isPreview = new URLSearchParams(window.location.search).get(
      "preview",
    ) === "true";
    if (isPreview) {
      const secure = window.location.protocol === "https:" ? " Secure;" : "";
      document.cookie = `etc_preview=1; path=/; max-age=3600; SameSite=Lax;${secure}`;
    }
  }, []);

  const onSubmit = async (values: IntakeValues) => {
    setServerError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...values }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Failed (${res.status})`);
      }
      const data = (await res.json()) as StartSessionResponse;
      if (data.is_complete || !data.next_question) {
        router.push(`/assess/${slug}/done`);
      } else {
        router.push(`/assess/${slug}/session`);
      }
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    }
  };

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        ETC POD assessment
      </p>
      <h1 className="mt-2 text-2xl font-bold leading-tight">{title}</h1>
      {introText && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {introText}
        </p>
      )}

      <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-etc-marigold bg-etc-marigold/10 px-3 py-1 text-[0.7rem] font-medium text-etc-black">
        <span aria-hidden>⏱</span>
        Plan around <strong>~{estimatedMinutes} min</strong> to finish — that&rsquo;s the longest case if you use every timer in full.
      </div>

      <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
        <li>· Some questions are timed — answer as quickly and accurately as you can.</li>
        <li>· Wrong answers may deduct points. Skip if unsure.</li>
        <li>· One question at a time. You cannot return to a previous question.</li>
      </ul>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Full name" error={errors.name?.message}>
          <input
            type="text"
            autoComplete="name"
            inputMode="text"
            {...register("name")}
            className={inputClass}
          />
        </Field>

        <Field label="Email" error={errors.email?.message}>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            {...register("email")}
            className={inputClass}
          />
        </Field>

        <Field
          label="Phone (optional)"
          error={errors.phone?.message}
          hint="WhatsApp-reachable preferred"
        >
          <input
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            {...register("phone")}
            className={inputClass}
          />
        </Field>

        {serverError && (
          <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
            {serverError}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "mt-1 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {isSubmitting ? "Starting…" : "Start assessment"}
        </button>
      </form>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background";

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && !error && (
        <span className="text-[0.7rem] text-muted-foreground">{hint}</span>
      )}
      {error && <span className="text-[0.7rem] text-destructive">{error}</span>}
    </label>
  );
}
