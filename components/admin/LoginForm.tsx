"use client";

/**
 * Magic-link login form. Calls supabase.auth.signInWithOtp on submit.
 * Supabase emails the candidate a link to /admin/auth-callback?code=...,
 * which our route handler exchanges for a session cookie.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});
type Values = z.infer<typeof schema>;

function humaniseError(code: string | null): string | null {
  if (!code) return null;
  if (code === "not_authorized") {
    return "That email isn't on the admin allowlist. Ask a superadmin to invite you.";
  }
  return code;
}

export function LoginForm({
  next,
  initialError = null,
}: {
  next: string;
  initialError?: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    humaniseError(initialError),
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async ({ email }: Values) => {
    setErrorMessage(null);
    const supabase = createSupabaseBrowserClient();
    // Always send people back to the canonical admin host. If we used
    // window.location.origin here, signing in from a Netlify branch URL
    // (e.g. main--etc-pod-assessment.netlify.app) would produce a
    // redirect_to that's not in the Supabase allowlist, and the magic
    // link would land on the wrong page.
    const redirectTo = `https://admin.energytalentco.com/admin/auth-callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  };

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-sm">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        ETC POD admin
      </p>
      <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We&rsquo;ll email you a one-time link.
      </p>

      {status === "sent" ? (
        <div className="mt-6 rounded-xl border border-etc-marigold bg-etc-marigold/10 p-4 text-sm text-etc-black">
          Check your inbox for the sign-in link.
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              {...register("email")}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
            {errors.email && (
              <span className="text-[0.7rem] text-destructive">
                {errors.email.message}
              </span>
            )}
          </label>
          {errorMessage && (
            <p className="rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {errorMessage}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "mt-1 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {isSubmitting ? "Sending…" : "Send magic link"}
          </button>
        </form>
      )}
    </div>
  );
}
