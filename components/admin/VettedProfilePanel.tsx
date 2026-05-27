"use client";

/**
 * VettedProfilePanel — admin drill-in for the synthesised profile.
 *
 * Renders:
 *   - Header: hire recommendation + overall confidence + needs-review badge
 *   - One card per specialisation with band/level, cadre, per-skill
 *     breakdown, mindset chips, qualified scopes, reservation flags,
 *     rationale, and override buttons
 *   - Override modal with required-reasoning textarea
 *   - Audit trail of past overrides
 *
 * Inline edits POST to /api/admin/vetted-talent-profile/[id] which
 * enforces the reasoning gate server-side.
 */

import { useState } from "react";

import type {
  HireRecommendation,
  MindsetProfileEntry,
  PerSkillBreakdownRow,
  ReservationFlag,
  ValidationOverride,
  ValidationResult,
  VettedTalentProfile,
} from "@/lib/db/schema";

type Bundle = {
  validation_result: ValidationResult;
  profiles: VettedTalentProfile[];
  overrides: ValidationOverride[];
};

type OverrideModalState =
  | { kind: "closed" }
  | {
      kind: "open";
      profileId: string;
      field:
        | "band"
        | "level"
        | "mindset_profile"
        | "qualified_scopes"
        | "reservation_flags";
      oldValue: unknown;
    };

const HIRE_BADGE_COLOR: Record<HireRecommendation, string> = {
  hire: "bg-green-100 text-green-900 border-green-300",
  no_hire: "bg-red-100 text-red-900 border-red-300",
  borderline: "bg-amber-100 text-amber-900 border-amber-300",
  requires_human_review: "bg-blue-100 text-blue-900 border-blue-300",
};

const BAND_LABEL = { junior: "Junior", mid: "Mid-Level", senior: "Senior" };
const LEVEL_LABEL = {
  below: "Below Standard",
  nh: "New Hire",
  g: "Growing",
  p: "Pro",
  tp: "Top Performer",
};

export function VettedProfilePanel({
  initial,
  responseId,
}: {
  initial: Bundle;
  responseId: string;
}) {
  const [bundle, setBundle] = useState<Bundle>(initial);
  const [modal, setModal] = useState<OverrideModalState>({ kind: "closed" });

  async function refresh() {
    const res = await fetch(`/api/admin/responses/${responseId}/vetted-profile`);
    if (res.ok) setBundle((await res.json()) as Bundle);
  }

  async function submitOverride(args: {
    profileId: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reasoning: string;
  }) {
    const res = await fetch(
      `/api/admin/vetted-talent-profile/${args.profileId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: args.field,
          old_value: args.oldValue,
          new_value: args.newValue,
          reasoning: args.reasoning,
        }),
      },
    );
    if (!res.ok) {
      const data = (await res.json()) as { error?: string; message?: string };
      alert(data.message ?? data.error ?? "Override failed.");
      return;
    }
    setModal({ kind: "closed" });
    await refresh();
  }

  const { validation_result, profiles, overrides } = bundle;
  const overallConfidence = (validation_result.confidence / 100).toFixed(2);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4">
        <a
          href={`/admin/responses/${responseId}`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← back to response
        </a>
      </div>

      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vetted Talent Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Synthesised by {validation_result.synthesisedBy} on{" "}
            {validation_result.synthesisedAt?.toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {validation_result.requiresHumanReview && (
            <span className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-900">
              Needs review
            </span>
          )}
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${HIRE_BADGE_COLOR[validation_result.hireRecommendation]}`}
          >
            {validation_result.hireRecommendation.replace(/_/g, " ")}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            confidence {overallConfidence}
          </span>
        </div>
      </header>

      {/* Per-spec cards */}
      <div className="space-y-6">
        {profiles.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No per-specialisation profiles. The synthesis step may have
            errored — check ai_spend_ledger + notify_log.
          </p>
        ) : (
          profiles.map((p) => (
            <SpecCard
              key={p.id}
              profile={p}
              onOverrideBand={() =>
                setModal({
                  kind: "open",
                  profileId: p.id,
                  field: "band",
                  oldValue: p.finalBand,
                })
              }
              onOverrideLevel={() =>
                setModal({
                  kind: "open",
                  profileId: p.id,
                  field: "level",
                  oldValue: p.finalLevel,
                })
              }
            />
          ))
        )}
      </div>

      {/* Audit trail */}
      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Override audit trail ({overrides.length})
        </h2>
        {overrides.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            No overrides yet.
          </p>
        ) : (
          <div className="space-y-2">
            {overrides.map((o) => (
              <div
                key={o.id}
                className="rounded-xl border border-border bg-card p-3 text-xs"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{o.field}</span>
                  <span className="text-muted-foreground">
                    {o.overriddenAt.toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {JSON.stringify(o.oldValue)} → {JSON.stringify(o.newValue)}
                </div>
                {o.reasoning && (
                  <p className="mt-2 italic text-foreground">{o.reasoning}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {modal.kind === "open" && (
        <OverrideModal
          state={modal}
          onCancel={() => setModal({ kind: "closed" })}
          onSubmit={submitOverride}
        />
      )}
    </main>
  );
}

/* ---------- Per-spec card ---------- */

function SpecCard({
  profile,
  onOverrideBand,
  onOverrideLevel,
}: {
  profile: VettedTalentProfile;
  onOverrideBand: () => void;
  onOverrideLevel: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">{profile.specialisation}</h3>
          <p className="mt-1 text-sm font-medium">{profile.displayLabel}</p>
          <p className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
            Cadre (learner-facing): {profile.cadre}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <span className="text-muted-foreground">
            Claimed: {BAND_LABEL[profile.claimedBand]}
          </span>
          <span className="text-muted-foreground">
            Final: {BAND_LABEL[profile.finalBand]} ·{" "}
            {LEVEL_LABEL[profile.finalLevel]}
          </span>
          <span className="text-muted-foreground tabular-nums">
            confidence {(profile.confidence / 100).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border pb-3 text-[0.7rem]">
        <button
          onClick={onOverrideBand}
          className="rounded-md border border-border bg-background px-2 py-1 hover:border-etc-marigold"
        >
          Override band
        </button>
        <button
          onClick={onOverrideLevel}
          className="rounded-md border border-border bg-background px-2 py-1 hover:border-etc-marigold"
        >
          Override level
        </button>
      </div>

      {/* Per-skill breakdown */}
      {profile.perSkillBreakdown.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Per-skill breakdown
          </p>
          <div className="space-y-1 text-xs">
            {profile.perSkillBreakdown.map((row: PerSkillBreakdownRow) => (
              <div key={row.skill_id} className="flex justify-between">
                <span>{row.skill_name}</span>
                <span className="font-medium tabular-nums">
                  {LEVEL_LABEL[row.level]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mindset chips */}
      {profile.mindsetProfile.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Mindsets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.mindsetProfile.map((m: MindsetProfileEntry, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium ${
                  m.strength === "strong"
                    ? "border-green-300 bg-green-50 text-green-900"
                    : m.strength === "emerging"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {m.mindset} · {m.strength}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Qualified scopes */}
      {profile.qualifiedScopes.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Qualified scopes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {profile.qualifiedScopes.map((s: string) => (
              <span
                key={s}
                className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[0.7rem] font-medium"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reservation flags */}
      {profile.reservationFlags.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Reservation flags
          </p>
          <div className="space-y-1.5">
            {profile.reservationFlags.map((f: ReservationFlag, i) => (
              <div
                key={i}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  f.severity === "critical"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : f.severity === "warn"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-border bg-muted text-muted-foreground"
                }`}
              >
                {f.flag}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rationale */}
      {profile.rationale && (
        <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs">
          <p className="mb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Rationale
          </p>
          <p className="leading-relaxed">{profile.rationale}</p>
        </div>
      )}
    </section>
  );
}

/* ---------- Override modal ---------- */

function OverrideModal({
  state,
  onCancel,
  onSubmit,
}: {
  state: OverrideModalState & { kind: "open" };
  onCancel: () => void;
  onSubmit: (args: {
    profileId: string;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reasoning: string;
  }) => Promise<void>;
}) {
  const [newValue, setNewValue] = useState<string>(
    typeof state.oldValue === "string" ? state.oldValue : "",
  );
  const [reasoning, setReasoning] = useState("");
  const requiresReasoning = state.field === "band" || state.field === "qualified_scopes";
  const enough = !requiresReasoning || reasoning.trim().length >= 20;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Override {state.field}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Current value: <code>{JSON.stringify(state.oldValue)}</code>
        </p>

        <label className="mt-4 block">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            New value
          </span>
          {state.field === "band" ? (
            <select
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm"
            >
              <option value="junior">junior</option>
              <option value="mid">mid</option>
              <option value="senior">senior</option>
            </select>
          ) : state.field === "level" ? (
            <select
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm"
            >
              <option value="below">below</option>
              <option value="nh">nh</option>
              <option value="g">g</option>
              <option value="p">p</option>
              <option value="tp">tp</option>
            </select>
          ) : (
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background p-2 text-sm"
            />
          )}
        </label>

        <label className="mt-3 block">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Reasoning {requiresReasoning && "(≥20 chars, required)"}
          </span>
          <textarea
            rows={3}
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            className="mt-1 w-full resize-y rounded-lg border border-input bg-background p-2 text-sm"
            placeholder="Explain why this override is justified…"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:border-etc-marigold"
          >
            Cancel
          </button>
          <button
            disabled={!enough}
            onClick={() =>
              onSubmit({
                profileId: state.profileId,
                field: state.field,
                oldValue: state.oldValue,
                newValue,
                reasoning: reasoning.trim(),
              })
            }
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            Save override
          </button>
        </div>
      </div>
    </div>
  );
}
