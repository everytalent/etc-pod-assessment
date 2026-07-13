"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const RESEND_COOLDOWN_SECS = 45;

export function VerifyClient({
  token,
  assessmentSlug,
  maskedEmail,
}: {
  token: string;
  assessmentSlug: string;
  maskedEmail: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<"sending" | "entering" | "checking" | "success">(
    "sending",
  );
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const autoSent = useRef(false);

  const sendCode = async () => {
    setError(null);
    setPhase("sending");
    try {
      const res = await fetch(`/take-tenant/${token}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(
          body.error === "email_send_failed"
            ? "We couldn't email the code. Try again in a moment."
            : `Could not send the code (${body.error ?? res.status}).`,
        );
        setPhase("entering");
        return;
      }
      setPhase("entering");
      setCooldown(RESEND_COOLDOWN_SECS);
    } catch {
      setError("Network hiccup. Try again in a moment.");
      setPhase("entering");
    }
  };

  useEffect(() => {
    if (autoSent.current) return;
    autoSent.current = true;
    void sendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setError(null);
    setPhase("checking");
    try {
      const res = await fetch(`/take-tenant/${token}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check", code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === "wrong_code") {
          setAttemptsRemaining(body.attempts_remaining ?? null);
          setError(
            body.attempts_remaining === 0
              ? "Too many wrong attempts. Request a new code."
              : `Wrong code. ${body.attempts_remaining ?? "A few"} attempt${
                  body.attempts_remaining === 1 ? "" : "s"
                } left.`,
          );
        } else if (body.error === "code_expired") {
          setError("That code has expired. Request a new one.");
        } else if (body.error === "no_code_pending") {
          setError("No code pending. Request one below.");
        } else if (body.error === "too_many_attempts") {
          setError("Too many attempts. Request a new code.");
        } else {
          setError("Could not verify the code. Try again.");
        }
        setPhase("entering");
        return;
      }
      setPhase("success");
      router.push(`/assess/${assessmentSlug}/session`);
    } catch {
      setError("Network hiccup. Try again.");
      setPhase("entering");
    }
  };

  return (
    <section className="mt-6 space-y-4">
      <form onSubmit={check} className="space-y-4">
        <label className="block">
          <span className="text-xs font-medium">6-digit code</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="mt-1 h-12 w-full rounded-lg border border-input bg-background px-3 text-center text-2xl font-semibold tracking-[0.5em]"
            placeholder="••••••"
            autoFocus
          />
        </label>
        {error && (
          <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={phase === "checking" || phase === "sending" || code.length < 6}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--tenant-primary, #f1b240)" }}
        >
          {phase === "checking"
            ? "Verifying..."
            : phase === "success"
              ? "Verified — loading assessment..."
              : "Verify and start"}
        </button>
      </form>

      <div className="flex items-center justify-between text-[0.7rem] text-muted-foreground">
        <span>
          Sent to <span className="font-medium text-foreground">{maskedEmail}</span>
        </span>
        <button
          type="button"
          onClick={sendCode}
          disabled={cooldown > 0 || phase === "sending" || phase === "checking"}
          className="underline-offset-4 hover:text-foreground hover:underline disabled:no-underline disabled:opacity-60"
        >
          {phase === "sending"
            ? "Sending..."
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : "Resend code"}
        </button>
      </div>
      {attemptsRemaining !== null && attemptsRemaining <= 2 && (
        <p className="text-[0.65rem] text-muted-foreground">
          If you keep getting it wrong, check your inbox for the most recent
          email — older codes are invalidated when you resend.
        </p>
      )}
    </section>
  );
}
