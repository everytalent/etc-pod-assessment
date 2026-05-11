"use client";

/**
 * Response table — sortable + drill-in + selection mode for bulk delete.
 *
 * Default mode: click a row → drill-in.
 * Selection mode: click "Select" → checkboxes appear → tick rows → click
 * "Delete N" to confirm and bulk-delete.
 *
 * `canDelete` is gated server-side per role (editor+ can delete); when
 * false, the Select toggle is hidden.
 */

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ResponseDrillIn } from "./ResponseDrillIn";

import { cn } from "@/lib/utils";

type Row = {
  id: string;
  candidateName: string;
  candidateEmail: string;
  status: "in_progress" | "submitted" | "abandoned";
  pass: boolean | null;
  totalScore: number | null;
  maxPossibleScore: number;
  startedAt: Date | string;
  submittedAt: Date | string | null;
  timeOnTaskSeconds: number | null;
  answeredCount: number;
  isPreview?: boolean;
};

type SortKey = "submittedAt" | "totalScore" | "timeOnTaskSeconds";
type SortDir = "asc" | "desc";

const STATUS_STYLE: Record<Row["status"], string> = {
  in_progress: "border-border bg-muted text-muted-foreground",
  submitted: "border-etc-marigold bg-etc-marigold/15 text-etc-black",
  abandoned: "border-border bg-secondary text-muted-foreground",
};

export function ResponseTable({
  rows,
  canDelete = false,
  canRunAi = false,
}: {
  rows: Row[];
  canDelete?: boolean;
  /** Server-resolved: does this viewer have AI pipeline access? */
  canRunAi?: boolean;
}) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkAi, setBulkAi] = useState<
    | { phase: "idle" }
    | {
        phase: "running";
        action: "score" | "accept";
        done: number;
        total: number;
      }
    | { phase: "done"; action: "score" | "accept"; errors: string[] }
  >({ phase: "idle" });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sortDir === "asc" ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  const setSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(sorted.map((r) => r.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
    setError(null);
  };

  const onBulkRunAi = async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Run AI scoring on ${selected.size} response${selected.size === 1 ? "" : "s"}? Each response runs the full Gemini → Kimi sample → consensus pipeline. This can take a couple of minutes per response on long papers.`,
      )
    ) {
      return;
    }
    const ids = Array.from(selected);
    setBulkAi({ phase: "running", action: "score", done: 0, total: ids.length });
    setError(null);
    const errors: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        // Plan
        const planRes = await fetch(
          `/api/admin/responses/${id}/cross-check-plan`,
        );
        if (!planRes.ok) throw new Error(`plan ${planRes.status}`);
        const plan = (await planRes.json()) as {
          scorable: { answerId: string; maxPoints: number }[];
          existing: { gemini: string[]; kimi: string[] };
        };
        // Gemini on missing
        const geminiSet = new Set(plan.existing.gemini);
        const needsGemini = plan.scorable.filter(
          (a) => !geminiSet.has(a.answerId),
        );
        for (const a of needsGemini) {
          await fetch(`/api/admin/answers/${a.answerId}/cross-check-step`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "gemini" }),
          });
        }
        // Kimi sample
        const sample = pickRandom(plan.scorable, Math.min(3, plan.scorable.length));
        for (const a of sample) {
          await fetch(`/api/admin/answers/${a.answerId}/cross-check-step`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "kimi" }),
          });
        }
        // Finalize 1
        const finRes = await fetch(
          `/api/admin/responses/${id}/cross-check-plan`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );
        const summary = (await finRes.json().catch(() => ({}))) as {
          consensus?: string;
        };
        // If override, rescore the rest with Kimi
        if (summary.consensus === "override") {
          const sampleIds = new Set(sample.map((a) => a.answerId));
          const rest = plan.scorable.filter(
            (a) => !sampleIds.has(a.answerId),
          );
          for (const a of rest) {
            await fetch(`/api/admin/answers/${a.answerId}/cross-check-step`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ provider: "kimi" }),
            });
          }
          await fetch(`/api/admin/responses/${id}/cross-check-plan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
        }
      } catch (err) {
        errors.push(
          `${id.slice(0, 8)}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
      setBulkAi({
        phase: "running",
        action: "score",
        done: i + 1,
        total: ids.length,
      });
    }
    setBulkAi({ phase: "done", action: "score", errors });
    router.refresh();
  };

  const onBulkAcceptAi = async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Accept all AI suggestions on ${selected.size} response${selected.size === 1 ? "" : "s"}? Each response uses its consensus winner (1st assessor when agree, 2nd assessor when override).`,
      )
    ) {
      return;
    }
    const ids = Array.from(selected);
    setBulkAi({
      phase: "running",
      action: "accept",
      done: 0,
      total: ids.length,
    });
    setError(null);
    const errors: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        const res = await fetch(
          `/api/admin/responses/${id}/accept-ai-scores`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          throw new Error(body.message ?? body.error ?? `failed (${res.status})`);
        }
      } catch (err) {
        errors.push(
          `${id.slice(0, 8)}: ${err instanceof Error ? err.message : "failed"}`,
        );
      }
      setBulkAi({
        phase: "running",
        action: "accept",
        done: i + 1,
        total: ids.length,
      });
    }
    setBulkAi({ phase: "done", action: "accept", errors });
    router.refresh();
  };

  function pickRandom<T>(arr: T[], n: number): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy.slice(0, n);
  }

  const onBulkDelete = async () => {
    if (selected.size === 0) return;
    if (
      !confirm(
        `Delete ${selected.size} response${selected.size === 1 ? "" : "s"}? This cascades to all answers and cannot be undone.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/responses/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `failed (${res.status})`);
      }
      exitSelect();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No responses yet.
      </div>
    );
  }

  const allSelected = selected.size > 0 && selected.size === sorted.length;

  return (
    <>
      {/* Selection toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          {canDelete && !selectMode && (
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 hover:border-etc-marigold"
            >
              Select
            </button>
          )}
          {selectMode && (
            <>
              <button
                type="button"
                onClick={exitSelect}
                className="rounded-lg border border-border bg-background px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={allSelected ? clearSelection : selectAll}
                className="rounded-lg border border-border bg-background px-3 py-1.5"
              >
                {allSelected ? "Clear all" : `Select all (${sorted.length})`}
              </button>
              <span className="text-muted-foreground">
                {selected.size} selected
              </span>
            </>
          )}
        </div>
        {selectMode && (
          <div className="flex flex-wrap items-center gap-2">
            {canRunAi && (
              <>
                <button
                  type="button"
                  onClick={() => void onBulkRunAi()}
                  disabled={selected.size === 0 || bulkAi.phase === "running"}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-50"
                >
                  ✨ Run AI on {selected.size}
                </button>
                <button
                  type="button"
                  onClick={() => void onBulkAcceptAi()}
                  disabled={selected.size === 0 || bulkAi.phase === "running"}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-xs hover:border-etc-marigold disabled:opacity-50"
                >
                  Accept AI on {selected.size}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void onBulkDelete()}
              disabled={selected.size === 0 || deleting}
              className="inline-flex h-8 items-center rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
            </button>
          </div>
        )}
      </div>

      {bulkAi.phase === "running" && (
        <p className="mb-3 rounded-lg border border-dashed border-etc-marigold bg-etc-marigold/10 p-3 text-xs">
          {bulkAi.action === "score" ? "Running AI scoring" : "Accepting AI"} —{" "}
          response <strong>{bulkAi.done}</strong> of{" "}
          <strong>{bulkAi.total}</strong>
        </p>
      )}
      {bulkAi.phase === "done" && (
        <p className="mb-3 rounded-lg border border-border bg-background p-3 text-xs">
          {bulkAi.action === "score"
            ? "Bulk AI scoring complete"
            : "Bulk accept complete"}
          {bulkAi.errors.length > 0 ? (
            <>
              {" "}— with{" "}
              <span className="text-destructive">
                {bulkAi.errors.length} error
                {bulkAi.errors.length === 1 ? "" : "s"}
              </span>
              .
            </>
          ) : (
            "."
          )}
        </p>
      )}

      {error && (
        <p className="mb-3 rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              {selectMode && (
                <th className="w-10 px-3 py-3 pl-5">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() =>
                      allSelected ? clearSelection() : selectAll()
                    }
                    className="h-4 w-4 rounded border-border accent-etc-marigold"
                  />
                </th>
              )}
              <th className={cn("px-3 py-3 font-medium", !selectMode && "pl-5")}>
                Candidate
              </th>
              <th className="px-3 py-3 font-medium">Status</th>
              <SortableTh
                active={sortKey === "totalScore"}
                dir={sortDir}
                onClick={() => setSort("totalScore")}
                className="text-right"
              >
                Score
              </SortableTh>
              <th className="px-3 py-3 text-right font-medium">Q&apos;s</th>
              <SortableTh
                active={sortKey === "timeOnTaskSeconds"}
                dir={sortDir}
                onClick={() => setSort("timeOnTaskSeconds")}
                className="text-right"
              >
                Time
              </SortableTh>
              <SortableTh
                active={sortKey === "submittedAt"}
                dir={sortDir}
                onClick={() => setSort("submittedAt")}
                className="pr-5 text-right"
              >
                Submitted
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const isSelected = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  onClick={() => {
                    if (selectMode) toggleRow(r.id);
                    else setActiveId(r.id);
                  }}
                  className={cn(
                    "cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40",
                    selectMode && isSelected && "bg-etc-marigold/10",
                  )}
                >
                  {selectMode && (
                    <td className="w-10 px-3 py-3 pl-5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.candidateEmail}`}
                        checked={isSelected}
                        onChange={() => toggleRow(r.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded border-border accent-etc-marigold"
                      />
                    </td>
                  )}
                  <td
                    className={cn(
                      "px-3 py-3 align-middle",
                      !selectMode && "pl-5",
                    )}
                  >
                    <div className="font-medium">
                      {r.candidateName}
                      {r.isPreview && (
                        <span className="ml-2 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                          preview
                        </span>
                      )}
                    </div>
                    <div className="text-[0.7rem] text-muted-foreground">
                      {r.candidateEmail}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider",
                        STATUS_STYLE[r.status],
                      )}
                    >
                      {r.status === "submitted"
                        ? r.pass === true
                          ? "pass"
                          : r.pass === false
                            ? "fail"
                            : "submitted"
                        : r.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right align-middle tabular-nums">
                    {r.totalScore !== null ? (
                      <>
                        {r.totalScore}
                        <span className="text-xs text-muted-foreground">
                          {" / "}
                          {r.maxPossibleScore}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 text-right align-middle tabular-nums">
                    {r.answeredCount}
                  </td>
                  <td className="px-3 py-3 text-right align-middle tabular-nums text-muted-foreground">
                    {r.timeOnTaskSeconds != null
                      ? `${Math.round(r.timeOnTaskSeconds / 60)}m`
                      : "—"}
                  </td>
                  <td className="px-3 py-3 pr-5 text-right align-middle tabular-nums text-muted-foreground">
                    {r.submittedAt ? formatShort(r.submittedAt) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Drill-in only when NOT in select mode */}
      {activeId && !selectMode && (
        <ResponseDrillIn
          responseId={activeId}
          onClose={() => {
            setActiveId(null);
            // Pull fresh totals into the table after the drill-in closes
            // — without this the list shows the score from the initial
            // server render, even though manual / AI scoring inside the
            // drill-in already updated responses.totalScore in the DB.
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function sortValue(r: Row, key: SortKey): number | null {
  switch (key) {
    case "submittedAt":
      return r.submittedAt ? new Date(r.submittedAt).getTime() : null;
    case "totalScore":
      return r.totalScore;
    case "timeOnTaskSeconds":
      return r.timeOnTaskSeconds;
  }
}

function formatShort(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SortableTh({
  active,
  dir,
  onClick,
  className,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "cursor-pointer px-3 py-3 font-medium select-none",
        active ? "text-foreground" : "",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active && <span aria-hidden>{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
