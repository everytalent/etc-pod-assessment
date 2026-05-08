"use client";

/**
 * Response table — sortable by submitted_at, score, time-on-task. Click a row
 * to open a drill-in modal showing the full Q+A path with timing and the
 * branching path (responses.metadata.path).
 */

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
};

type SortKey = "submittedAt" | "totalScore" | "timeOnTaskSeconds";
type SortDir = "asc" | "desc";

const STATUS_STYLE: Record<Row["status"], string> = {
  in_progress: "border-border bg-muted text-muted-foreground",
  submitted: "border-etc-marigold bg-etc-marigold/15 text-etc-black",
  abandoned: "border-border bg-secondary text-muted-foreground",
};

export function ResponseTable({ rows }: { rows: Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("submittedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [activeId, setActiveId] = useState<string | null>(null);

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

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No responses yet.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 pl-5 font-medium">Candidate</th>
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
            {sorted.map((r) => (
              <tr
                key={r.id}
                onClick={() => setActiveId(r.id)}
                className="cursor-pointer border-b border-border last:border-b-0 hover:bg-muted/40"
              >
                <td className="px-3 py-3 pl-5 align-middle">
                  <div className="font-medium">{r.candidateName}</div>
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
            ))}
          </tbody>
        </table>
      </div>

      {activeId && (
        <ResponseDrillIn
          responseId={activeId}
          onClose={() => setActiveId(null)}
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
