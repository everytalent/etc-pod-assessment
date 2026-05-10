"use client";

import { useEffect } from "react";

const SUPPORT_EMAIL = "support@energytalentco.com";

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

  const ref = error.digest ?? "";
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    "Assessment issue",
  )}&body=${encodeURIComponent(
    `Hi ETC team,\n\nI hit an error while taking my assessment.${
      ref ? `\n\nReference: ${ref}` : ""
    }\n\n— `,
  )}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-destructive bg-card p-8 text-center shadow-sm">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-destructive">
          Something went wrong
        </p>
        <h1 className="mt-2 text-xl font-bold">
          We couldn&rsquo;t load this page
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your previous answers are saved. Try again first &mdash; if the
          issue continues, our team can sort it out quickly. Please include
          the reference below when you reach out so we can find your session.
        </p>
        {ref && (
          <p className="mt-3 font-mono text-[0.7rem] text-muted-foreground">
            ref: {ref}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
          <a
            href={mailto}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-medium hover:border-etc-marigold"
          >
            Email the team
          </a>
        </div>
        <p className="mt-4 text-[0.7rem] text-muted-foreground">
          {SUPPORT_EMAIL}
        </p>
      </div>
    </main>
  );
}
