"use client";

/**
 * Root error boundary — catches unhandled errors in any non-admin, non-
 * candidate route. Provides a reset action so users can retry without
 * a full reload.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to whatever observability we wire up later.
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-destructive bg-card p-8 text-center shadow-sm">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-destructive">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl font-bold">Unexpected error</h1>
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
          className="mt-5 inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
