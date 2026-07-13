"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

export type CandidateRow = {
  responseId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  decision: "hire" | "borderline" | "not_hire" | null;
  totalScore: number | null;
  maxPossibleScore: number;
  submittedAt: string | null;
  hasIntegrityIssue: boolean;
};

type DecisionFilter = "any" | "hire" | "borderline" | "not_hire" | "pending";
type StatusFilter = "any" | "in_progress" | "submitted";
type DateFilter = "any" | "24h" | "7d" | "30d" | "90d";
type IntegrityFilter = "any" | "clean" | "flagged";

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_MS: Record<Exclude<DateFilter, "any">, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export function AssessmentCandidatesTable({
  rows,
}: {
  rows: CandidateRow[];
}) {
  const [decision, setDecision] = useState<DecisionFilter>("any");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [dateRange, setDateRange] = useState<DateFilter>("any");
  const [integrity, setIntegrity] = useState<IntegrityFilter>("any");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const nowMs = Date.now();
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (decision === "pending" && r.decision !== null) return false;
      if (decision !== "any" && decision !== "pending" && r.decision !== decision) return false;
      if (status !== "any" && r.status !== status) return false;
      if (dateRange !== "any") {
        if (!r.submittedAt) return false;
        const ageMs = nowMs - new Date(r.submittedAt).getTime();
        if (ageMs > RANGE_MS[dateRange]) return false;
      }
      if (integrity === "clean" && r.hasIntegrityIssue) return false;
      if (integrity === "flagged" && !r.hasIntegrityIssue) return false;
      if (q) {
        const hay = `${r.candidateName} ${r.candidateEmail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, decision, status, dateRange, integrity, search]);

  const flaggedCount = rows.filter((r) => r.hasIntegrityIssue).length;
  const clearFilters =
    decision !== "any" ||
    status !== "any" ||
    dateRange !== "any" ||
    integrity !== "any" ||
    search.length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Decision">
            <FilterChip active={decision === "any"} onClick={() => setDecision("any")}>
              All
            </FilterChip>
            <FilterChip
              active={decision === "hire"}
              onClick={() => setDecision("hire")}
            >
              Hire
            </FilterChip>
            <FilterChip
              active={decision === "borderline"}
              onClick={() => setDecision("borderline")}
            >
              Borderline
            </FilterChip>
            <FilterChip
              active={decision === "not_hire"}
              onClick={() => setDecision("not_hire")}
            >
              Not hire
            </FilterChip>
            <FilterChip
              active={decision === "pending"}
              onClick={() => setDecision("pending")}
            >
              Pending
            </FilterChip>
          </FilterGroup>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Status">
            <FilterChip active={status === "any"} onClick={() => setStatus("any")}>
              All
            </FilterChip>
            <FilterChip
              active={status === "submitted"}
              onClick={() => setStatus("submitted")}
            >
              Submitted
            </FilterChip>
            <FilterChip
              active={status === "in_progress"}
              onClick={() => setStatus("in_progress")}
            >
              In progress
            </FilterChip>
          </FilterGroup>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Taken">
            <FilterChip
              active={dateRange === "any"}
              onClick={() => setDateRange("any")}
            >
              Any time
            </FilterChip>
            <FilterChip
              active={dateRange === "24h"}
              onClick={() => setDateRange("24h")}
            >
              Last 24h
            </FilterChip>
            <FilterChip
              active={dateRange === "7d"}
              onClick={() => setDateRange("7d")}
            >
              Last 7 days
            </FilterChip>
            <FilterChip
              active={dateRange === "30d"}
              onClick={() => setDateRange("30d")}
            >
              Last 30 days
            </FilterChip>
            <FilterChip
              active={dateRange === "90d"}
              onClick={() => setDateRange("90d")}
            >
              Last 90 days
            </FilterChip>
          </FilterGroup>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FilterGroup label="Integrity">
            <FilterChip
              active={integrity === "any"}
              onClick={() => setIntegrity("any")}
            >
              All ({rows.length})
            </FilterChip>
            <FilterChip
              active={integrity === "clean"}
              onClick={() => setIntegrity("clean")}
            >
              Clean only ({rows.length - flaggedCount})
            </FilterChip>
            <FilterChip
              active={integrity === "flagged"}
              onClick={() => setIntegrity("flagged")}
            >
              Flagged only ({flaggedCount})
            </FilterChip>
          </FilterGroup>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-xs"
          />
          {clearFilters && (
            <button
              type="button"
              onClick={() => {
                setDecision("any");
                setStatus("any");
                setDateRange("any");
                setIntegrity("any");
                setSearch("");
              }}
              className="text-[0.7rem] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>

        <p className="text-[0.65rem] text-muted-foreground">
          Showing {filtered.length} of {rows.length}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center text-xs text-muted-foreground">
          Nothing matches these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-border bg-muted/40 text-left text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Candidate</th>
                <th className="px-4 py-3 font-semibold">Decision</th>
                <th className="px-4 py-3 font-semibold text-right">Score</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Taken</th>
                <th className="px-4 py-3 font-semibold">Integrity</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.responseId} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {r.candidateName}
                    </div>
                    <div className="text-[0.65rem] text-muted-foreground">
                      {r.candidateEmail}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DecisionPill decision={r.decision} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.totalScore !== null
                      ? `${r.totalScore} / ${r.maxPossibleScore}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.submittedAt ? formatRelative(r.submittedAt) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <IntegrityDot flagged={r.hasIntegrityIssue} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/tenant/candidates/${r.responseId}`}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-3 text-[0.65rem] font-semibold transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-etc-marigold hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function DecisionPill({
  decision,
}: {
  decision: "hire" | "borderline" | "not_hire" | null;
}) {
  if (decision === null) {
    return (
      <span className="rounded-full bg-muted px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Pending
      </span>
    );
  }
  const label =
    decision === "hire"
      ? "Hire"
      : decision === "borderline"
        ? "Borderline"
        : "Not hire";
  const cls =
    decision === "hire"
      ? "bg-emerald-100 text-emerald-900"
      : decision === "borderline"
        ? "bg-amber-100 text-amber-900"
        : "bg-destructive/15 text-destructive";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "in_progress" ? "In progress" : status.replace(/_/g, " ");
  const cls =
    status === "in_progress"
      ? "bg-foreground text-background"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function IntegrityDot({ flagged }: { flagged: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[0.65rem]">
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 rounded-full",
          flagged ? "bg-destructive" : "bg-emerald-500",
        )}
      />
      <span className="text-muted-foreground">{flagged ? "Flagged" : "Clean"}</span>
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  }).format(d);
}
