"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SampleQuestion = {
  id: string;
  type: string;
  text: string;
  options: Array<{ id: string; label: string }>;
};

const TYPE_EXPLAINERS: Record<string, string> = {
  mcq: "Multiple choice. Pick the best answer. Don't worry about getting it right - this is practice.",
  open: "Open answer. Type a short response. We're just looking at how you express yourself.",
};

export function SampleRunner({
  token,
  assessmentSlug,
  questions,
}: {
  token: string;
  assessmentSlug: string;
  questions: SampleQuestion[];
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  if (questions.length === 0) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Sample assessment unavailable - going straight to the real
          assessment.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/take-tenant/${token}/verify`)}
          className="mt-4 inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-white"
          style={{ background: "var(--tenant-primary, #f1b240)" }}
        >
          Start the real assessment
        </button>
      </section>
    );
  }

  const skipToReal = () => {
    router.push(`/take-tenant/${token}/verify`);
  };

  if (index >= questions.length) {
    return (
      <section className="mt-6 rounded-2xl border border-border bg-card p-6 text-center">
        <h2 className="text-base font-semibold">Ready?</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          The real assessment starts now. Your answers from here on count.
          Take your time.
        </p>
        <button
          type="button"
          onClick={skipToReal}
          className="mt-5 inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-white"
          style={{ background: "var(--tenant-primary, #f1b240)" }}
        >
          Start the real assessment
        </button>
      </section>
    );
  }

  const q = questions[index];
  return (
    <section className="mt-6 space-y-4">
      <p className="rounded-lg border border-border bg-muted/30 p-3 text-[0.7rem] text-muted-foreground">
        {TYPE_EXPLAINERS[q.type] ??
          "Practice question. Doesn't count toward your result."}
      </p>
      <article className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium">{q.text}</p>
        {q.type === "mcq" ? (
          <ul className="mt-3 space-y-2">
            {q.options.map((opt) => (
              <li key={opt.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background p-2 text-xs hover:border-etc-marigold">
                  <input type="radio" name={`sample_${q.id}`} />
                  <span>{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <textarea
            placeholder="Type a short answer..."
            rows={4}
            className="mt-3 w-full rounded-lg border border-input bg-background p-2 text-sm"
          />
        )}
      </article>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={skipToReal}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Skip practice
        </button>
        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          className="inline-flex h-10 items-center rounded-lg px-4 text-xs font-semibold text-white"
          style={{ background: "var(--tenant-primary, #f1b240)" }}
        >
          {index + 1 === questions.length ? "Done with practice" : "Next"}
        </button>
      </div>
      <p className="text-center text-[0.6rem] text-muted-foreground">
        {index + 1} of {questions.length}
      </p>
      <p className="text-center text-[0.55rem] text-muted-foreground">
        Token: {token.slice(0, 6)}...
      </p>
    </section>
  );
}
