"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const STAGE_LABELS: Record<string, string> = {
  reading_role: "Reading your input",
  calibrating: "Calibrating the framework",
  crafting: "Crafting the questions",
  finalising: "Finalising your assessment",
  ready: "Ready",
  failed: "Generation failed",
};

export function WaitingClient({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<string>(mapStage(initialStatus));
  const [failed, setFailed] = useState(false);
  const [failureReason, setFailureReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/tenant/assessment-banks/${id}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) timer = window.setTimeout(tick, 4000);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (data.stage === "ready") {
          router.push(`/tenant/assessments/${id}`);
          return;
        }
        if (data.stage === "failed") {
          setFailed(true);
          setFailureReason(data.failure_reason ?? null);
          return;
        }
        setStage(data.stage);
        timer = window.setTimeout(tick, 4000);
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 4000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [id, router]);

  if (failed) {
    return (
      <section className="mx-auto max-w-xl rounded-2xl border border-destructive bg-card p-8 text-center">
        <h1 className="text-xl font-bold">Generation failed</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We hit an error generating your assessment. Your generation credit
          has been refunded.
        </p>
        {failureReason && (
          <p className="mt-3 rounded-lg bg-muted p-2 text-[0.7rem] text-muted-foreground">
            {failureReason}
          </p>
        )}
        <button
          type="button"
          onClick={() => router.push("/tenant/assessments/new")}
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background"
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
      <div className="flex justify-center">
        <Spinner />
      </div>
      <h1 className="mt-6 text-xl font-bold">{STAGE_LABELS[stage] ?? stage}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        ETC's Assessment Algorithm is at work. You can wait here, or close this
        tab. We will email you when it is ready.
      </p>
      <ProgressStages current={stage} />
    </section>
  );
}

function ProgressStages({ current }: { current: string }) {
  const stages = ["reading_role", "calibrating", "crafting", "finalising"];
  const idx = stages.indexOf(current);
  return (
    <ol className="mt-6 flex items-center justify-center gap-1.5">
      {stages.map((s, i) => (
        <li
          key={s}
          className="h-1.5 w-8 rounded-full"
          style={{
            background:
              i <= idx ? "var(--tenant-primary, #f1b240)" : "rgba(0,0,0,0.1)",
          }}
        />
      ))}
    </ol>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-muted border-t-foreground"
      aria-hidden
    />
  );
}

function mapStage(status: string): string {
  if (status === "queued" || status === "analysing") return "reading_role";
  return status;
}
