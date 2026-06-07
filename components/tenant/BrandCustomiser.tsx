"use client";

/**
 * Brand customisation surface (PRD §0b).
 *
 * Used in two places:
 *   1. First-run onboarding — final card of /tenant/assessments/onboarding
 *   2. Settings update — /tenant/settings/branding
 *
 * Captures primary colour, accent colour, and optional logo upload, with
 * a live preview pane that updates as the tenant edits. The preview is a
 * mock candidate landing card rendered with the in-progress colours.
 *
 * WCAG-AA contrast warning fires when the primary against white falls
 * below 3:1 (a soft warning, not a hard block).
 */

import { useMemo, useState, useTransition } from "react";

import { TENANT_BRAND_DEFAULTS } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type BrandCustomiserSave = (input: {
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  completeOnboarding: boolean;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export function BrandCustomiser({
  initialPrimary,
  initialAccent,
  initialLogoUrl,
  completeOnboardingOnSave,
  onSave,
  tenantName,
}: {
  initialPrimary?: string;
  initialAccent?: string;
  initialLogoUrl?: string | null;
  completeOnboardingOnSave: boolean;
  onSave: BrandCustomiserSave;
  tenantName: string;
}) {
  const [primary, setPrimary] = useState(
    initialPrimary ?? TENANT_BRAND_DEFAULTS.primaryColor,
  );
  const [accent, setAccent] = useState(
    initialAccent ?? TENANT_BRAND_DEFAULTS.accentColor,
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl ?? null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const primaryValid = HEX_RE.test(primary);
  const accentValid = HEX_RE.test(accent);
  const lowContrast = useMemo(
    () => primaryValid && contrastVsWhite(primary) < 3,
    [primary, primaryValid],
  );

  const handleSave = () => {
    if (!primaryValid || !accentValid) {
      setError("Both colours must be valid #RRGGBB hex.");
      return;
    }
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const res = await onSave({
        primaryColor: primary,
        accentColor: accent,
        logoUrl,
        completeOnboarding: completeOnboardingOnSave,
      });
      if (!res.ok) setError(res.error);
      else setSaved(true);
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
      <section className="space-y-5 rounded-2xl border border-border bg-card p-5">
        <header>
          <h2 className="text-sm font-semibold">Workspace brand</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Used on candidate-facing pages. You can change this later from
            Settings.
          </p>
        </header>

        <ColorField
          label="Primary colour"
          value={primary}
          onChange={setPrimary}
          valid={primaryValid}
        />
        <ColorField
          label="Accent colour"
          value={accent}
          onChange={setAccent}
          valid={accentValid}
        />

        <label className="block text-xs">
          <span className="block font-medium text-foreground">
            Logo URL (optional)
          </span>
          <span className="block text-muted-foreground">
            Upload coming in a later phase. For now paste a public PNG or SVG
            URL.
          </span>
          <input
            type="url"
            placeholder="https://..."
            value={logoUrl ?? ""}
            onChange={(e) => setLogoUrl(e.target.value.trim() || null)}
            className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </label>

        {lowContrast && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[0.7rem] text-amber-900">
            Heads up: your primary colour has low contrast against white. It
            may be hard to read for some candidates.
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg border border-green-300 bg-green-50 p-2 text-xs text-green-900">
            Saved.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={cn(
              "inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold",
              "bg-foreground text-background disabled:opacity-60",
            )}
          >
            {saving ? "Saving..." : completeOnboardingOnSave ? "Save and continue" : "Save changes"}
          </button>
        </div>
      </section>

      <BrandPreview
        primary={primaryValid ? primary : TENANT_BRAND_DEFAULTS.primaryColor}
        accent={accentValid ? accent : TENANT_BRAND_DEFAULTS.accentColor}
        logoUrl={logoUrl}
        tenantName={tenantName}
      />
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
  valid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="block font-medium text-foreground">{label}</span>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-background"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="#000000"
          spellCheck={false}
          className={cn(
            "h-10 w-32 rounded-lg border bg-background px-3 font-mono text-sm",
            valid ? "border-input" : "border-destructive",
          )}
        />
        {!valid && (
          <span className="text-[0.7rem] text-destructive">Invalid hex</span>
        )}
      </div>
    </label>
  );
}

function BrandPreview({
  primary,
  accent,
  logoUrl,
  tenantName,
}: {
  primary: string;
  accent: string;
  logoUrl: string | null;
  tenantName: string;
}) {
  return (
    <section
      aria-label="Live preview"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Live preview — candidate landing
      </p>
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: accent }}
      >
        <header
          className="flex items-center gap-3 px-4 py-3"
          style={{ background: accent, color: "#fff" }}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={tenantName} className="h-7 w-auto" />
          ) : (
            <span className="text-sm font-semibold">{tenantName}</span>
          )}
          <span className="ml-auto text-[0.6rem] uppercase tracking-wider opacity-70">
            Powered by ETC
          </span>
        </header>
        <div className="bg-background p-5">
          <h3 className="text-lg font-semibold">Welcome.</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            We'll walk you through a short practice round before the real
            assessment.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-white"
            style={{ background: primary }}
          >
            Start practice
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- contrast helper ---------- */

function contrastVsWhite(hex: string): number {
  const lum = luminance(hex);
  return (1 + 0.05) / (lum + 0.05);
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
