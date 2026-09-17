"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  candidate_name: z.string().trim().min(2).max(120),
  candidate_email: z.string().trim().toLowerCase().email(),
  candidate_phone: z
    .string()
    .trim()
    .min(6, "Enter the phone number we can reach you on")
    .max(40)
    .regex(/^[+0-9()\-\s]+$/, "Digits, spaces, +, - and () only"),
  accessibility_flag: z.boolean(),
});

type Values = z.infer<typeof schema>;

/** Where this browser remembers the details it last submitted. */
const REMEMBERED_KEY = "etc:candidate-contact";

export function CandidateLandingForm({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { accessibility_flag: false },
  });

  /**
   * Fill this in for them wherever we can.
   *
   * This link is one link shared with many candidates, so unlike the
   * talent-profile route we genuinely do not know who is opening it and
   * cannot skip the step. What we can do is stop asking twice.
   *
   * Two sources, invite link first: an invite may carry name, email and
   * phone as query parameters, which lets whoever sends it pass on
   * details the candidate already gave when they applied. Failing that,
   * whatever this browser filled in last time, so anyone who comes back
   * (or gets bounced back from the verification step) is not retyping
   * from scratch.
   *
   * Kept to this device. Contact details are not worth putting anywhere
   * else to save a candidate thirty seconds of typing.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = {
      candidate_name: params.get("name") ?? params.get("candidate_name") ?? "",
      candidate_email: params.get("email") ?? params.get("candidate_email") ?? "",
      candidate_phone: params.get("phone") ?? params.get("candidate_phone") ?? "",
    };

    let remembered: Partial<Values> = {};
    try {
      const raw = window.localStorage.getItem(REMEMBERED_KEY);
      if (raw) remembered = JSON.parse(raw) as Partial<Values>;
    } catch {
      // Private browsing, blocked storage, or a value we can no longer
      // parse. Prefill is a convenience; losing it changes nothing.
    }

    const merged = {
      candidate_name: fromLink.candidate_name || remembered.candidate_name || "",
      candidate_email:
        fromLink.candidate_email || remembered.candidate_email || "",
      candidate_phone:
        fromLink.candidate_phone || remembered.candidate_phone || "",
      accessibility_flag: remembered.accessibility_flag ?? false,
    };
    if (
      merged.candidate_name ||
      merged.candidate_email ||
      merged.candidate_phone ||
      merged.accessibility_flag
    ) {
      reset(merged);
    }
  }, [reset]);

  const onSubmit = async (values: Values) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/take-tenant/${token}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `${res.status}`);
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      try {
        window.localStorage.setItem(REMEMBERED_KEY, JSON.stringify(values));
      } catch {
        // Not worth failing a started assessment over.
      }
      router.push(`/take-tenant/${token}/sample?response=${data.response_id}`);
    } catch {
      setError("Could not start the assessment. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <label className="block text-xs">
        <span className="block font-medium">Full name</span>
        <input
          autoComplete="name"
          {...register("candidate_name")}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        />
        {errors.candidate_name && (
          <span className="text-[0.7rem] text-destructive">
            {errors.candidate_name.message}
          </span>
        )}
      </label>
      <label className="block text-xs">
        <span className="block font-medium">Email</span>
        <input
          type="email"
          autoComplete="email"
          {...register("candidate_email")}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        />
        {errors.candidate_email && (
          <span className="text-[0.7rem] text-destructive">
            {errors.candidate_email.message}
          </span>
        )}
      </label>
      <label className="block text-xs">
        <span className="block font-medium">
          Phone number{" "}
          <span className="font-normal text-muted-foreground">
            (WhatsApp preferred)
          </span>
        </span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+234..."
          {...register("candidate_phone")}
          className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
        />
        {errors.candidate_phone && (
          <span className="text-[0.7rem] text-destructive">
            {errors.candidate_phone.message}
          </span>
        )}
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" {...register("accessibility_flag")} className="mt-0.5" />
        <span>
          I need extra time on questions (we&apos;ll give you 50% more on each
          one).
        </span>
      </label>
      {error && (
        <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: "var(--tenant-primary, #f1b240)" }}
      >
        {submitting ? "Starting..." : "Start practice round"}
      </button>
    </form>
  );
}
