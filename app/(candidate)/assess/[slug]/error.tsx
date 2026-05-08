"use client";

import { useEffect } from "react";

export default function AssessError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AssessError]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-destructive bg-card p-8 text-center shadow-sm">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-destructive">
          Hmm — something glitched
        </p>
        <h1 className="mt-2 text-xl font-bold">We couldn&rsquo;t load that</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your previous answers are saved. Tap retry to keep going.
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
          Retry
        </button>
      </div>
    </main>
  );
}
