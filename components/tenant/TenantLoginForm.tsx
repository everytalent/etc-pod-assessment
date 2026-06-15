"use client";

/**
 * Tenant sign-in: 6-digit code emailed by Supabase, posted to
 * /tenant/verify-otp which establishes the session cookie and checks the
 * tenant_users allowlist. We deliberately don't pass emailRedirectTo —
 * the user types the code instead of clicking a link.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
});
type EmailValues = z.infer<typeof emailSchema>;

const codeSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});
type CodeValues = z.infer<typeof codeSchema>;

function humaniseError(code: string | null): string | null {
  if (!code) return null;
  if (code === "not_authorized") {
    return "That email isn't on this workspace's allowlist. Ask your workspace owner to invite you.";
  }
  return code;
}

export function TenantLoginForm({
  next,
  initialError = null,
}: {
  next: string;
  initialError?: string | null;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    humaniseError(initialError),
  );

  const emailForm = useForm<EmailValues>({ resolver: zodResolver(emailSchema) });
  const codeForm = useForm<CodeValues>({ resolver: zodResolver(codeSchema) });

  const onSubmitEmail = async ({ email: submitted }: EmailValues) => {
    setErrorMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({ email: submitted });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setEmail(submitted);
    setStage("code");
  };

  const onSubmitCode = async ({ token }: CodeValues) => {
    setErrorMessage(null);
    const res = await fetch("/tenant/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, token, next }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      setErrorMessage(humaniseError(data?.error ?? "Could not verify code"));
      return;
    }
    router.push(data.next || next || "/tenant");
    router.refresh();
  };

  const resendCode = async () => {
    if (!email) return;
    setErrorMessage(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) setErrorMessage(error.message);
  };

  return (
    <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-sm">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        ETC workspace
      </p>
      <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {stage === "email"
          ? "We'll email you a 6-digit code."
          : `Enter the 6-digit code we sent to ${email}.`}
      </p>

      {stage === "email" ? (
        <form
          onSubmit={emailForm.handleSubmit(onSubmitEmail)}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              {...emailForm.register("email")}
              className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
            {emailForm.formState.errors.email && (
              <span className="text-[0.7rem] text-destructive">
                {emailForm.formState.errors.email.message}
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
            disabled={emailForm.formState.isSubmitting}
            className={cn(
              "mt-1 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {emailForm.formState.isSubmitting ? "Sending..." : "Send code"}
          </button>
        </form>
      ) : (
        <form
          onSubmit={codeForm.handleSubmit(onSubmitCode)}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              6-digit code
            </span>
            <input
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              {...codeForm.register("token")}
              className="h-12 w-full rounded-xl border border-input bg-background px-3 text-center text-lg font-semibold tracking-[0.4em] text-foreground placeholder:text-muted-foreground focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
            {codeForm.formState.errors.token && (
              <span className="text-[0.7rem] text-destructive">
                {codeForm.formState.errors.token.message}
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
            disabled={codeForm.formState.isSubmitting}
            className={cn(
              "mt-1 inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {codeForm.formState.isSubmitting ? "Verifying..." : "Sign in"}
          </button>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setStage("email");
                setErrorMessage(null);
                codeForm.reset();
              }}
              className="underline-offset-2 hover:underline"
            >
              Use a different email
            </button>
            <button
              type="button"
              onClick={resendCode}
              className="underline-offset-2 hover:underline"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
