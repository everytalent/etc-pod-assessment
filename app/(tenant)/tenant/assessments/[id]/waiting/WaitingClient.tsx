"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ProverbEngine } from "@/components/tenant/ProverbEngine";
import { StageTracker } from "@/components/tenant/StageTracker";

const STAGE_LABELS: Record<string, string> = {
  reading_role: "Reading your input",
  calibrating: "Calibrating the framework",
  crafting: "Crafting the questions",
  finalising: "Finalising your assessment",
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
  // Bumping this restarts the polling effect — used after a retry resets
  // the bank from 'failed' back to 'queued' so we resume status checks.
  const [pollEpoch, setPollEpoch] = useState(0);

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
  }, [id, router, pollEpoch]);

  if (failed) {
    return (
      <FailedView
        id={id}
        failureReason={failureReason}
        onRetried={() => {
          setFailed(false);
          setFailureReason(null);
          setStage("reading_role");
          setPollEpoch((n) => n + 1);
        }}
      />
    );
  }

  return (
    <section className="mx-auto max-w-xl text-center">
      <h1 className="text-xl font-bold">{STAGE_LABELS[stage] ?? stage}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        ETC&apos;s Assessment Algorithm is at work. You can wait here, or close
        this tab. We will email you when it is ready.
      </p>
      <div className="mt-6">
        <StageTracker current={stage} />
      </div>
      <ProverbEngine stage={stage} />
    </section>
  );
}

function mapStage(status: string): string {
  if (status === "queued" || status === "analysing") return "reading_role";
  return status;
}

function FailedView({
  id,
  failureReason,
  onRetried,
}: {
  id: string;
  failureReason: string | null;
  onRetried: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const retry = async () => {
    setBusy("retry");
    setActionError(null);
    try {
      const res = await fetch(
        `/api/v1/tenant/assessment-banks/${id}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? `${res.status}`);
        setBusy(null);
        return;
      }
      onRetried();
      setBusy(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "retry failed");
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this failed assessment? This cannot be undone.")) {
      return;
    }
    setBusy("delete");
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/tenant/assessment-banks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error ?? `${res.status}`);
        setBusy(null);
        return;
      }
      router.push("/tenant/assessments");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "delete failed");
      setBusy(null);
    }
  };

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
      {actionError && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
          {actionError}
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => void retry()}
          disabled={busy !== null}
          className="inline-flex h-11 items-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {busy === "retry" ? "Retrying..." : "Retry this assessment"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/tenant/assessments/new")}
          disabled={busy !== null}
          className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium hover:border-etc-marigold disabled:opacity-50"
        >
          Start a new one
        </button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== null}
          className="inline-flex h-11 items-center rounded-xl border border-destructive/40 px-4 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
        >
          {busy === "delete" ? "Deleting..." : "Delete"}
        </button>
      </div>
      <p className="mt-4 text-[0.7rem] text-muted-foreground">
        Retry re-runs this same input through the algorithm — useful if the
        failure was a one-off or if we have shipped a fix since.
      </p>
    </section>
  );
}
