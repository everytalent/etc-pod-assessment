"use client";

import { useState } from "react";

/**
 * Admin-only trigger for POST /api/admin/skillboards/backfill-questions.
 * Runs a dry-run first, shows the plan, and only then executes.
 * Same-origin fetch, so it uses the admin session cookie automatically —
 * no manual cookie copying.
 */
export function BackfillQuestionsButton() {
  const [phase, setPhase] = useState<
    "idle" | "planning" | "plan" | "running" | "done"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<BackfillResult | null>(null);
  const [result, setResult] = useState<BackfillResult | null>(null);

  const plan_it = async () => {
    setError(null);
    setPlan(null);
    setResult(null);
    setPhase("planning");
    try {
      const res = await fetch(
        "/api/admin/skillboards/backfill-questions?dry_run=1",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? `${res.status}`);
        setPhase("idle");
        return;
      }
      setPlan(await res.json());
      setPhase("plan");
    } catch {
      setError("Network error.");
      setPhase("idle");
    }
  };

  const run_it = async () => {
    setError(null);
    setPhase("running");
    try {
      const res = await fetch(
        "/api/admin/skillboards/backfill-questions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? `${res.status}`);
        setPhase("plan");
        return;
      }
      setResult(await res.json());
      setPhase("done");
    } catch {
      setError("Network error.");
      setPhase("plan");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Backfill question banks</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Sweep every active skillboard, count questions per
            (band × level × task) cell, and enqueue Opus jobs for cells
            below 3 per cell. Skips cells at target and cells with jobs
            already in flight.
          </p>
        </div>
        {phase === "idle" || phase === "planning" ? (
          <button
            type="button"
            onClick={plan_it}
            disabled={phase === "planning"}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-3 text-xs font-semibold hover:border-etc-marigold disabled:opacity-60"
          >
            {phase === "planning" ? "Planning..." : "Preview backfill"}
          </button>
        ) : null}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {phase === "plan" && plan && (
        <PlanBox
          plan={plan}
          onCancel={() => {
            setPlan(null);
            setPhase("idle");
          }}
          onConfirm={run_it}
        />
      )}

      {phase === "running" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Enqueuing jobs...
        </p>
      )}

      {phase === "done" && result && (
        <ResultBox
          result={result}
          onReset={() => {
            setResult(null);
            setPlan(null);
            setPhase("idle");
          }}
        />
      )}
    </div>
  );
}

type BackfillResult = {
  dry_run: boolean;
  target_per_cell: number;
  swept: number;
  cells_scanned: number;
  cells_short: number;
  jobs_enqueued: number;
  jobs_planned: number;
  estimated_cost_usd: number;
  per_board: Array<{
    skillboard_id: string;
    specialisation: string;
    cells_short: number;
    jobs_enqueued: number;
  }>;
};

function PlanBox({
  plan,
  onCancel,
  onConfirm,
}: {
  plan: BackfillResult;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const boardsWithWork = plan.per_board.filter((b) => b.cells_short > 0);
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-etc-marigold bg-etc-marigold/10 p-4 text-xs">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Boards swept" value={String(plan.swept)} />
        <Stat label="Cells scanned" value={plan.cells_scanned.toLocaleString()} />
        <Stat label="Cells short" value={plan.cells_short.toLocaleString()} />
        <Stat
          label="Est cost"
          value={`$${plan.estimated_cost_usd.toFixed(2)}`}
        />
      </div>
      <p className="text-muted-foreground">
        Would enqueue{" "}
        <span className="font-semibold text-foreground">
          {plan.jobs_planned.toLocaleString()}
        </span>{" "}
        jobs. Worker auto-approves output into each bank.
      </p>
      {boardsWithWork.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Per-skillboard breakdown ({boardsWithWork.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto pl-4 text-[0.65rem]">
            {boardsWithWork.map((b) => (
              <li key={b.skillboard_id} className="flex justify-between gap-4">
                <span>{b.specialisation}</span>
                <span className="font-mono text-muted-foreground">
                  {b.jobs_enqueued} jobs
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-xs font-semibold"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={plan.jobs_planned === 0}
          className="inline-flex h-9 items-center rounded-lg bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50"
        >
          {plan.jobs_planned === 0
            ? "Nothing to backfill"
            : `Enqueue ${plan.jobs_planned} jobs`}
        </button>
      </div>
    </div>
  );
}

function ResultBox({
  result,
  onReset,
}: {
  result: BackfillResult;
  onReset: () => void;
}) {
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs">
      <p className="font-semibold text-emerald-900">
        Enqueued {result.jobs_enqueued.toLocaleString()} jobs across{" "}
        {result.swept} skillboards.
      </p>
      <p className="text-muted-foreground">
        The worker picks these up on its next tick (~1 min) and auto-
        approves the generated questions into each validation bank.
        Est cost ${result.estimated_cost_usd.toFixed(2)}.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="text-xs font-medium underline-offset-4 hover:underline"
      >
        Run another sweep
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}
