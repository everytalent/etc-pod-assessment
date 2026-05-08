"use client";

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AdminError]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="rounded-2xl border border-destructive bg-card p-8">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-destructive">
          Admin error
        </p>
        <h1 className="mt-2 text-xl font-bold">Something broke in this view</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {error.message || "An unknown error occurred."}
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[0.7rem] text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex h-9 items-center rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
