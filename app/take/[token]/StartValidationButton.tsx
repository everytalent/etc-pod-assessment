"use client";

/**
 * Client-only button — calls /take/[token]/start to set the candidate
 * cookie server-side, then navigates to the assessment session runner.
 */

import { useState } from "react";

export function StartValidationButton({
  token,
  assessmentSlug,
}: {
  token: string;
  assessmentSlug: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleStart() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/take/${token}/start`, { method: "POST" });
    if (!res.ok) {
      setBusy(false);
      const data = await res.json().catch(() => ({}));
      setErr((data as { message?: string }).message ?? "Could not start session.");
      return;
    }
    window.location.assign(`/assess/${assessmentSlug}/session`);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-8 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start validation"}
      </button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
