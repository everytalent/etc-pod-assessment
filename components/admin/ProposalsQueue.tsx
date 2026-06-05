"use client";

/**
 * ProposalsQueue — list + cards for question bank proposals.
 *
 * Each card shows the proposed question + rubric + difficulty + scope.
 * Approve → merges into the sentinel `Validation Bank — <spec>`
 * assessment. Reject → notes textarea required.
 */

import { useCallback, useEffect, useState } from "react";

import type {
  PerformanceLevel,
  ProposalStatus,
  QuestionBankProposal,
  SeniorityBand,
} from "@/lib/db/schema";

type Status = ProposalStatus;

export function ProposalsQueue() {
  const [status, setStatus] = useState<Status>("pending");
  const [specialisation, setSpecialisation] = useState("");
  const [band, setBand] = useState<SeniorityBand | "">("");
  const [level, setLevel] = useState<PerformanceLevel | "">("");
  const [proposals, setProposals] = useState<QuestionBankProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ status });
    if (specialisation) params.set("specialisation", specialisation);
    if (band) params.set("band", band);
    if (level) params.set("level", level);
    const res = await fetch(`/api/admin/question-bank-proposals?${params}`);
    if (res.ok) {
      const data = (await res.json()) as { proposals: QuestionBankProposal[] };
      setProposals(data.proposals);
    }
    setLoading(false);
  }, [status, specialisation, band, level]);

  useEffect(() => {
    // setLoading inside load() is intentional — proposals page lifts
    // its loading flag synchronously on every filter change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function approve(id: string) {
    const res = await fetch(`/api/admin/question-bank-proposals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string; message?: string };
      alert(data.message ?? data.error ?? "Approve failed.");
      return;
    }
    await load();
  }

  async function rejectSubmit(id: string) {
    if (rejectionNotes.trim().length < 1) {
      alert("Rejection notes required.");
      return;
    }
    const res = await fetch(`/api/admin/question-bank-proposals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject", notes: rejectionNotes.trim() }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string; message?: string };
      alert(data.message ?? data.error ?? "Reject failed.");
      return;
    }
    setRejectingId(null);
    setRejectionNotes("");
    await load();
  }

  return (
    <div>
      {/* Filters */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FilterField label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Status)}
            className={inputCls}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </FilterField>
        <FilterField label="Specialisation">
          <input
            value={specialisation}
            onChange={(e) => setSpecialisation(e.target.value)}
            placeholder="Solar Sales Specialist"
            className={inputCls}
          />
        </FilterField>
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
            onChange={(e) =>
              setLevel(e.target.value as PerformanceLevel | "")
            }
            className={inputCls}
          >
            <option value="">All</option>
            <option value="below">Below</option>
            <option value="nh">NH</option>
            <option value="g">Growing</option>
            <option value="p">Pro</option>
            <option value="tp">TP</option>
          </select>
        </FilterField>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading…</p>
      )}

      {!loading && proposals.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
          No proposals match this filter.
        </p>
      )}

      <div className="space-y-3">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            onApprove={() => approve(p.id)}
            onStartReject={() => {
              setRejectingId(p.id);
              setRejectionNotes("");
            }}
            isRejecting={rejectingId === p.id}
            rejectionNotes={rejectionNotes}
            onRejectionNotesChange={setRejectionNotes}
            onConfirmReject={() => rejectSubmit(p.id)}
            onCancelReject={() => {
              setRejectingId(null);
              setRejectionNotes("");
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  onApprove,
  onStartReject,
  isRejecting,
  rejectionNotes,
  onRejectionNotesChange,
  onConfirmReject,
  onCancelReject,
}: {
  proposal: QuestionBankProposal;
  onApprove: () => void;
  onStartReject: () => void;
  isRejecting: boolean;
  rejectionNotes: string;
  onRejectionNotesChange: (s: string) => void;
  onConfirmReject: () => void;
  onCancelReject: () => void;
}) {
  const payload = proposal.payload as {
    question_text: string;
    question_type: string;
    options?: Array<{ id: string; label: string }>;
    correct_answer?: string[];
    scoring_rubric: string;
    difficulty_score: number;
    competency_area?: string;
    interactive_config?: unknown;
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        <span className="rounded-full border border-border bg-muted px-2 py-0.5">
          {proposal.specialisation}
        </span>
        {proposal.band && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5">
            {proposal.band}
          </span>
        )}
        {proposal.level && (
          <span className="rounded-full border border-border bg-muted px-2 py-0.5">
            {proposal.level}
          </span>
        )}
        <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-900">
          {payload.question_type}
        </span>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900">
          difficulty {payload.difficulty_score}
        </span>
        <span className="ml-auto normal-case text-muted-foreground">
          {new Date(proposal.proposedAt).toLocaleDateString()} · by{" "}
          {proposal.proposedBy}
        </span>
      </div>

      <p className="text-sm font-medium">{payload.question_text}</p>

      {payload.options && payload.options.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {payload.options.map((o) => (
            <li
              key={o.id}
              className={`rounded-md border px-2 py-1 ${
                payload.correct_answer?.includes(o.id)
                  ? "border-green-300 bg-green-50 text-green-900"
                  : "border-border bg-background"
              }`}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Scoring rubric
        </summary>
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 leading-relaxed">
          {payload.scoring_rubric}
        </p>
      </details>

      {payload.interactive_config !== undefined &&
        payload.interactive_config !== null && (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Interactive config
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted/40 p-2 text-[0.7rem]">
              {JSON.stringify(payload.interactive_config, null, 2)}
            </pre>
          </details>
        )}

      {proposal.status === "pending" && (
        <div className="mt-3 border-t border-border pt-3">
          {!isRejecting ? (
            <div className="flex justify-end gap-2">
              <button
                onClick={onStartReject}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-1 text-xs font-medium text-red-900 hover:bg-red-100"
              >
                Reject
              </button>
              <button
                onClick={onApprove}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                Approve → bank
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={rejectionNotes}
                onChange={(e) => onRejectionNotesChange(e.target.value)}
                rows={2}
                placeholder="Why is this wrong? (required)"
                className="w-full resize-y rounded-lg border border-input bg-background p-2 text-xs"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancelReject}
                  className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium hover:border-etc-marigold"
                >
                  Cancel
                </button>
                <button
                  onClick={onConfirmReject}
                  className="rounded-md bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground hover:opacity-90"
                >
                  Confirm reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {proposal.status !== "pending" && proposal.reviewNotes && (
        <p className="mt-2 rounded-lg bg-muted/40 p-2 text-[0.7rem] italic">
          Review notes: {proposal.reviewNotes}
        </p>
      )}
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
