"use client";

/**
 * New-skillboard creation form (Claude-authored path).
 *
 * - Role family pre-selected by suggestRoleFamily() as admin types.
 * - On submit, POST /api/admin/skillboards. Handles:
 *     201 → redirect to /admin/skillboards/[id]
 *     409 → "specialisation exists" error
 *     422 (brief_too_weak) → render missing chips + Opus suggestions inline
 *     other → generic error banner
 */

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { SkillboardRoleFamily } from "@/lib/db/schema";
import {
  suggestRoleFamily,
  type RoleFamilySuggestion,
} from "@/lib/engines/assessment/skillboards/role-family-suggest";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | {
      kind: "brief_too_weak";
      score: number;
      missing: string[];
      suggested_additions: string;
    };

export function NewSkillboardForm() {
  const router = useRouter();

  const [specialisation, setSpecialisation] = useState("");
  const [description, setDescription] = useState("");
  const [referenceUrls, setReferenceUrls] = useState<string[]>([""]);
  const [roleFamily, setRoleFamily] = useState<SkillboardRoleFamily | null>(
    null,
  );
  const [suggestion, setSuggestion] = useState<RoleFamilySuggestion | null>(
    null,
  );
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  // Re-suggest as the user types. If they haven't manually overridden
  // (roleFamily is still aligned with previous suggestion), update.
  useEffect(() => {
    const next = suggestRoleFamily({ specialisation, brief: description });
    setSuggestion(next);
    if (
      next.suggested &&
      (roleFamily === null || roleFamily === suggestion?.suggested)
    ) {
      setRoleFamily(next.suggested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialisation, description]);

  const canSubmit = useMemo(
    () =>
      specialisation.trim().length >= 1 &&
      description.trim().length >= 20 &&
      roleFamily !== null &&
      state.kind !== "submitting",
    [specialisation, description, roleFamily, state.kind],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleFamily) return;
    setState({ kind: "submitting" });

    const body = {
      creation_path: "claude_authored" as const,
      specialisation: specialisation.trim(),
      description: description.trim(),
      role_family: roleFamily,
      reference_urls: referenceUrls
        .map((u) => u.trim())
        .filter((u) => u.length > 0),
    };

    const res = await fetch("/api/admin/skillboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 201) {
      const data = (await res.json()) as { skillboard_id: string };
      router.push(`/admin/skillboards/${data.skillboard_id}`);
      return;
    }
    if (res.status === 422) {
      const data = (await res.json()) as {
        error: string;
        score: number;
        missing: string[];
        suggested_additions: string;
      };
      if (data.error === "brief_too_weak") {
        setState({
          kind: "brief_too_weak",
          score: data.score,
          missing: data.missing,
          suggested_additions: data.suggested_additions,
        });
        return;
      }
    }
    if (res.status === 409) {
      const data = (await res.json()) as { message?: string };
      setState({
        kind: "error",
        message: data.message ?? "This specialisation already exists.",
      });
      return;
    }
    const text = await res.text().catch(() => "");
    setState({
      kind: "error",
      message: `Failed to create skillboard (${res.status}): ${text.slice(0, 200)}`,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-2xl border border-border bg-card p-6"
    >
      {/* Specialisation */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Specialisation name
        </label>
        <input
          type="text"
          value={specialisation}
          onChange={(e) => setSpecialisation(e.target.value)}
          required
          maxLength={120}
          placeholder="e.g. Solar Installation Specialist"
          className="mt-2 w-full rounded-xl border border-input bg-background p-3 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
        />
      </div>

      {/* Role family */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Role family
        </label>
        {suggestion && (
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            <span className="font-medium">Suggestion:</span> {suggestion.reason}
          </p>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["technical", "bd_pm", "hybrid"] as const).map((rf) => (
            <button
              key={rf}
              type="button"
              onClick={() => setRoleFamily(rf)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                roleFamily === rf
                  ? "border-etc-marigold bg-etc-marigold/10"
                  : "border-border bg-background hover:border-etc-marigold/50"
              }`}
            >
              <div className="font-medium">
                {rf === "technical"
                  ? "Technical"
                  : rf === "bd_pm"
                    ? "BD / PM"
                    : "Hybrid"}
              </div>
              <div className="text-[0.7rem] text-muted-foreground">
                {rf === "technical"
                  ? "Installation, design, O&M, engineering"
                  : rf === "bd_pm"
                    ? "Sales, accounts, partnerships, PM"
                    : "Mix of technical + commercial"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Description (brief) */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Brief
        </label>
        <p className="mt-1 text-[0.7rem] text-muted-foreground">
          A good brief includes: ① project size / scale ② primary
          geography ③ 2-3 example deliverables ④ how this differs
          from adjacent roles.
        </p>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={20}
          maxLength={2000}
          rows={6}
          placeholder="Describe the role, typical scope, geography, key deliverables…"
          className="mt-2 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
        />
        <div className="mt-1 text-[0.7rem] text-muted-foreground">
          {description.length} / 2000 characters
        </div>
      </div>

      {/* Reference URLs */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reference URLs (optional, max 5)
        </label>
        <p className="mt-1 text-[0.7rem] text-muted-foreground">
          Industry standards, training materials, or JDs Claude should
          reference. Claude may also web-search.
        </p>
        <div className="mt-2 space-y-2">
          {referenceUrls.map((url, i) => (
            <input
              key={i}
              type="url"
              value={url}
              onChange={(e) =>
                setReferenceUrls((prev) =>
                  prev.map((u, idx) => (idx === i ? e.target.value : u)),
                )
              }
              placeholder="https://…"
              className="w-full rounded-xl border border-input bg-background p-2 text-sm focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
            />
          ))}
          {referenceUrls.length < 5 && (
            <button
              type="button"
              onClick={() => setReferenceUrls((prev) => [...prev, ""])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              + add another
            </button>
          )}
        </div>
      </div>

      {/* Brief-too-weak feedback */}
      {state.kind === "brief_too_weak" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            Brief needs more substance (score: {state.score.toFixed(2)})
          </p>
          <p className="mt-1 text-xs text-amber-900">
            Missing:{" "}
            {state.missing.map((m) => (
              <span
                key={m}
                className="mr-1 inline-flex rounded-full border border-amber-400 bg-amber-100 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-amber-900"
              >
                {m}
              </span>
            ))}
          </p>
          <p className="mt-3 text-xs text-amber-900">
            <span className="font-semibold">Suggested additions:</span>{" "}
            {state.suggested_additions}
          </p>
        </div>
      )}

      {/* Other errors */}
      {state.kind === "error" && (
        <div className="rounded-xl border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {state.message}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {state.kind === "submitting"
            ? "Authoring structure (5-30s)…"
            : "Create skillboard"}
        </button>
      </div>
    </form>
  );
}
