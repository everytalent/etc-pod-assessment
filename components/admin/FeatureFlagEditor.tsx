"use client";

/**
 * Renders a feature-flag's enabled_for_roles as a set of checkboxes and
 * PATCHes the API on save. Generic over the flag key so this works for
 * future flags too — caller supplies the title + description.
 */

import { useState } from "react";

type Role = "superadmin" | "admin" | "editor" | "assessor";

const ALL_ROLES: { id: Role; label: string; hint?: string }[] = [
  { id: "superadmin", label: "Superadmin", hint: "Always allowed; cannot be unchecked." },
  { id: "admin", label: "Admin" },
  { id: "editor", label: "Editor" },
  {
    id: "assessor",
    label: "Assessor",
    hint:
      "Only sees AI on an answer AFTER they save their own score for that answer.",
  },
];

export function FeatureFlagEditor({
  flagKey,
  title,
  description,
  initialRoles,
}: {
  flagKey: string;
  title: string;
  description: string;
  initialRoles: string[];
}) {
  // Superadmin is always on — guarantees a superadmin can never lock
  // themselves out of AI panels. We seed it into the initial state
  // directly rather than effecting it in render.
  const [roles, setRoles] = useState<Set<Role>>(() => {
    const seeded = new Set<Role>(
      initialRoles.filter((r): r is Role =>
        ALL_ROLES.some((x) => x.id === r),
      ),
    );
    seeded.add("superadmin");
    return seeded;
  });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (role: Role) => {
    if (role === "superadmin") return; // locked on
    const next = new Set(roles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setRoles(next);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feature-flags/${flagKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled_for_roles: Array.from(roles),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(
          (body.message as string) ??
            (body.error as string) ??
            `failed (${res.status})`,
        );
      }
      setSavedAt(new Date().toLocaleString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>

      <ul className="mt-5 space-y-3">
        {ALL_ROLES.map((r) => {
          const checked = roles.has(r.id);
          const locked = r.id === "superadmin";
          return (
            <li key={r.id}>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={() => toggle(r.id)}
                  className="mt-1 h-4 w-4 accent-etc-marigold disabled:opacity-60"
                />
                <span>
                  <span className="text-sm font-medium text-foreground">
                    {r.label}
                  </span>
                  {r.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {r.hint}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && (
          <span className="text-xs text-muted-foreground">Saved {savedAt}</span>
        )}
      </div>
    </div>
  );
}
