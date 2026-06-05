"use client";

/**
 * ValidationBankBrowser — filter/search UI for the questions inside a
 * Validation Bank sentinel assessment (mode='validation').
 *
 * Why not the flat AssessmentBuilder: banks can hold hundreds of
 * questions, no order is meaningful (the CAT picker chooses
 * dynamically), and what admins need is filtered triage.
 *
 * Filters: band, level, type, free-text search across question_text +
 * competency_area + specialisation.
 *
 * Each row links to the existing question edit modal via
 * /admin/assessments/[id]/edit?question=<id> (handled by the
 * AssessmentBuilder route if we ever add deep-link). For now, rows
 * are display-only — author edits flow through the proposals queue.
 */

import { useMemo, useState } from "react";

import type { PerformanceLevel, SeniorityBand } from "@/lib/db/schema";

type Question = {
  id: string;
  questionText: string;
  type: string;
  band: SeniorityBand | null;
  level: PerformanceLevel | null;
  difficultyScore: number | null;
  competencyArea: string | null;
  specialisation: string | null;
};

const LEVEL_LABEL: Record<PerformanceLevel, string> = {
  below: "Below",
  nh: "New Hire",
  g: "Growing",
  p: "Pro",
  tp: "Top Performer",
};

export function ValidationBankBrowser({
  assessment,
  questions,
}: {
  assessment: { id: string; title: string; specialisation: string | null };
  questions: Question[];
}) {
  const [band, setBand] = useState<SeniorityBand | "">("");
  const [level, setLevel] = useState<PerformanceLevel | "">("");
  const [type, setType] = useState<string>("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return questions.filter((row) => {
      if (band && row.band !== band) return false;
      if (level && row.level !== level) return false;
      if (type && row.type !== type) return false;
      if (q.length > 0) {
        const hay = `${row.questionText} ${row.competencyArea ?? ""} ${row.specialisation ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [questions, band, level, type, search]);

  // Counts per (band, level) for the matrix display.
  const matrix = useMemo(() => {
    const bands: SeniorityBand[] = ["junior", "mid", "senior"];
    const levels: PerformanceLevel[] = ["below", "nh", "g", "p", "tp"];
    const grid: Record<string, number> = {};
    for (const b of bands) {
      for (const l of levels) {
        grid[`${b}|${l}`] = 0;
      }
    }
    for (const q of questions) {
      if (q.band && q.level) {
        const k = `${q.band}|${q.level}`;
        if (grid[k] !== undefined) grid[k] += 1;
      }
    }
    return { grid, bands, levels };
  }, [questions]);

  const types = useMemo(
    () => Array.from(new Set(questions.map((q) => q.type))).sort(),
    [questions],
  );

  return (
    <div>
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Validation Bank
        </p>
        <h1 className="mt-2 text-2xl font-bold">
          {assessment.specialisation ?? assessment.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {questions.length} approved questions in the candidate bank.
          The CAT picker selects from these adaptively — no manual
          ordering needed. Add new questions via{" "}
          <a
            href="/admin/question-bank-proposals"
            className="underline hover:text-foreground"
          >
            proposals
          </a>
          .
        </p>
      </header>

      {/* Coverage matrix */}
      <section className="mb-8">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Coverage by band × level
        </h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Band</th>
                {matrix.levels.map((l) => (
                  <th key={l} className="px-3 py-2 text-center font-medium">
                    {LEVEL_LABEL[l]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {matrix.bands.map((b) => (
                <tr key={b}>
                  <td className="px-3 py-2 font-medium capitalize">{b}</td>
                  {matrix.levels.map((l) => {
                    const n = matrix.grid[`${b}|${l}`];
                    const cls =
                      n === 0
                        ? "bg-red-50 text-red-900"
                        : n < 3
                          ? "bg-amber-50 text-amber-900"
                          : "bg-green-50 text-green-900";
                    return (
                      <td
                        key={l}
                        className={`px-3 py-2 text-center font-mono text-sm tabular-nums ${cls}`}
                      >
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[0.65rem] text-muted-foreground">
          Cells with 0 questions can't be probed by the CAT engine.
          Cells with fewer than 3 may bias the level estimate.
        </p>
      </section>

      {/* Filters */}
      <section className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FilterField label="Band">
          <select
            value={band}
            onChange={(e) => setBand(e.target.value as SeniorityBand | "")}
            className={inputCls}
          >
            <option value="">All</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
          </select>
        </FilterField>
        <FilterField label="Level">
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as PerformanceLevel | "")}
            className={inputCls}
          >
            <option value="">All</option>
            {(Object.entries(LEVEL_LABEL) as [PerformanceLevel, string][]).map(
              ([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ),
            )}
          </select>
        </FilterField>
        <FilterField label="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={inputCls}
          >
            <option value="">All</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Search">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="text / competency / spec"
            className={inputCls}
          />
        </FilterField>
      </section>

      {/* Results */}
      <p className="mb-2 text-xs text-muted-foreground">
        Showing {filtered.length} of {questions.length} questions
      </p>
      <div className="space-y-2">
        {filtered.map((q) => (
          <div
            key={q.id}
            className="rounded-xl border border-border bg-card p-3 text-xs"
          >
            <div className="mb-1 flex flex-wrap items-center gap-1 text-[0.65rem]">
              <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-900">
                {q.type}
              </span>
              {q.band && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 capitalize">
                  {q.band}
                </span>
              )}
              {q.level && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5">
                  {LEVEL_LABEL[q.level]}
                </span>
              )}
              {q.difficultyScore !== null && (
                <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">
                  difficulty {q.difficultyScore}
                </span>
              )}
              {q.competencyArea && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 italic text-muted-foreground">
                  {q.competencyArea}
                </span>
              )}
            </div>
            <p className="text-foreground">{q.questionText}</p>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No questions match these filters.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold";
