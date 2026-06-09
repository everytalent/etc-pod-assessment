"use client";

/**
 * Comprehensive brand customisation surface — sections mirror JD
 * Studio: Workspace identity, Account contact, Brand (logo + colours),
 * Footer toggle.
 *
 * Used in two places:
 *   1. Onboarding modal — completeOnboardingOnSave=true
 *   2. /tenant/settings/branding — completeOnboardingOnSave=false
 *
 * Logo upload is paste-URL for now (Phase 2 will swap for Supabase
 * Storage `tenant-logos` bucket with multipart upload).
 */

import { useEffect, useMemo, useState, useTransition } from "react";

import { TENANT_BRAND_DEFAULTS } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type BrandCustomiserSave = (input: {
  primaryColor: string;
  accentColor: string;
  primaryTextColor: string;
  logoUrl: string | null;
  textMark: string | null;
  supportEmail: string | null;
  companyUrl: string | null;
  footerText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  showPoweredByEtc: boolean;
  completeOnboarding: boolean;
}) => Promise<{ ok: true } | { ok: false; error: string }>;

export function BrandCustomiser({
  initialPrimary,
  initialAccent,
  initialPrimaryText,
  initialLogoUrl,
  initialTextMark,
  initialSupportEmail,
  initialCompanyUrl,
  initialFooterText,
  initialContactEmail,
  initialContactPhone,
  initialShowPoweredByEtc,
  completeOnboardingOnSave,
  onSave,
  tenantName,
}: {
  initialPrimary?: string;
  initialAccent?: string;
  initialPrimaryText?: string;
  initialLogoUrl?: string | null;
  initialTextMark?: string | null;
  initialSupportEmail?: string | null;
  initialCompanyUrl?: string | null;
  initialFooterText?: string | null;
  initialContactEmail?: string | null;
  initialContactPhone?: string | null;
  initialShowPoweredByEtc?: boolean;
  completeOnboardingOnSave: boolean;
  onSave: BrandCustomiserSave;
  tenantName: string;
}) {
  // Pull catalog if not all initial values were passed.
  const [hydrated, setHydrated] = useState(false);
  const [primary, setPrimary] = useState(
    initialPrimary ?? TENANT_BRAND_DEFAULTS.primaryColor,
  );
  const [accent, setAccent] = useState(
    initialAccent ?? TENANT_BRAND_DEFAULTS.accentColor,
  );
  const [primaryText, setPrimaryText] = useState(
    initialPrimaryText ?? TENANT_BRAND_DEFAULTS.accentColor,
  );
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl ?? null);
  const [textMark, setTextMark] = useState<string>(initialTextMark ?? "");
  const [supportEmail, setSupportEmail] = useState(initialSupportEmail ?? "");
  const [companyUrl, setCompanyUrl] = useState(initialCompanyUrl ?? "");
  const [footerText, setFooterText] = useState(initialFooterText ?? "");
  const [contactEmail, setContactEmail] = useState(initialContactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(initialContactPhone ?? "");
  const [showPoweredByEtc, setShowPoweredByEtc] = useState(
    initialShowPoweredByEtc ?? true,
  );
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // If we weren't given initial values, fetch from API once.
  useEffect(() => {
    if (hydrated) return;
    if (initialPrimary && initialAccent) {
      setHydrated(true);
      return;
    }
    void fetch("/api/v1/tenant/branding", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b) return;
        if (b.primary_color) setPrimary(b.primary_color);
        if (b.accent_color) setAccent(b.accent_color);
        if (b.primary_text_color) setPrimaryText(b.primary_text_color);
        if (b.logo_url !== undefined) setLogoUrl(b.logo_url);
        if (b.text_mark) setTextMark(b.text_mark);
        if (b.support_email) setSupportEmail(b.support_email);
        if (b.company_url) setCompanyUrl(b.company_url);
        if (b.footer_text) setFooterText(b.footer_text);
        if (b.contact_email) setContactEmail(b.contact_email);
        if (b.contact_phone) setContactPhone(b.contact_phone);
        if (typeof b.show_powered_by_etc === "boolean")
          setShowPoweredByEtc(b.show_powered_by_etc);
      })
      .finally(() => setHydrated(true));
  }, [hydrated, initialPrimary, initialAccent]);

  const primaryValid = HEX_RE.test(primary);
  const accentValid = HEX_RE.test(accent);
  const primaryTextValid = HEX_RE.test(primaryText);
  const lowContrast = useMemo(
    () => primaryValid && contrastVsWhite(primary) < 3,
    [primary, primaryValid],
  );

  const handleSave = () => {
    if (!primaryValid || !accentValid || !primaryTextValid) {
      setError("Colours must be valid #RRGGBB hex.");
      return;
    }
    setError(null);
    setSaved(false);
    startSaving(async () => {
      const res = await onSave({
        primaryColor: primary,
        accentColor: accent,
        primaryTextColor: primaryText,
        logoUrl,
        textMark: textMark.trim() || null,
        supportEmail: supportEmail.trim() || null,
        companyUrl: companyUrl.trim() || null,
        footerText: footerText.trim() || null,
        contactEmail: contactEmail.trim() || null,
        contactPhone: contactPhone.trim() || null,
        showPoweredByEtc,
        completeOnboarding: completeOnboardingOnSave,
      });
      if (!res.ok) setError(res.error);
      else setSaved(true);
    });
  };

  return (
    <div className="space-y-6">
      {/* WORKSPACE */}
      <Section
        title="Workspace"
        hint="Public-facing identity that appears on candidate emails and footers."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Workspace name" hint="Read-only — set at signup.">
            <input
              type="text"
              value={tenantName}
              readOnly
              className="h-10 w-full rounded-lg border border-input bg-muted/30 px-3 text-sm"
            />
          </Field>
          <Field
            label="Support email"
            hint="Shown on candidate-facing pages as the apply-to address."
          >
            <input
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="support@yourcompany.com"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Company URL" hint="Appears in the footer.">
            <input
              type="url"
              value={companyUrl}
              onChange={(e) => setCompanyUrl(e.target.value)}
              placeholder="https://www.yourcompany.com"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Footer text" hint="The line at the bottom of every page.">
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Your Company · Assessments"
              maxLength={200}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>
      </Section>

      {/* ACCOUNT CONTACT */}
      <Section
        title="Account contact"
        hint="Private to ETC. We use these for support follow-ups and account questions."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Your email" hint="Private to ETC.">
            <input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </Field>
          <Field label="Your phone" hint="Optional. Used for support follow-ups.">
            <input
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+234..."
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
            />
          </Field>
        </div>
      </Section>

      {/* BRAND */}
      <Section title="Brand" hint="Colours and logo for candidate-facing pages.">
        <Field
          label="Logo URL"
          hint="Paste a public PNG/SVG URL. Upload UI coming next phase."
        >
          {logoUrl && (
            <div className="mb-2 rounded-lg border border-border bg-muted/30 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoUrl} alt="Current logo" className="h-12 w-auto" />
            </div>
          )}
          <input
            type="url"
            value={logoUrl ?? ""}
            onChange={(e) => setLogoUrl(e.target.value.trim() || null)}
            placeholder="https://..."
            className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
          />
        </Field>

        <Field
          label="Or text mark (up to 4 chars)"
          hint="Saves instead of a logo image. Leave blank to keep your current logo."
        >
          <input
            type="text"
            value={textMark}
            onChange={(e) => setTextMark(e.target.value.slice(0, 4))}
            placeholder="ETC"
            maxLength={4}
            className="h-10 w-32 rounded-lg border border-input bg-background px-3 text-sm font-semibold uppercase"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <ColorField
            label="Primary colour"
            hint="Buttons, accents, section headings."
            value={primary}
            onChange={setPrimary}
            valid={primaryValid}
          />
          <ColorField
            label="Primary text colour"
            hint="Drawn on top of the primary colour."
            value={primaryText}
            onChange={setPrimaryText}
            valid={primaryTextValid}
          />
          <ColorField
            label="Accent colour"
            hint="Used sparingly for hover effects."
            value={accent}
            onChange={setAccent}
            valid={accentValid}
          />
        </div>
        {lowContrast && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[0.7rem] text-amber-900">
            Heads up: your primary colour has low contrast against white. It
            may be hard to read for some candidates.
          </p>
        )}
      </Section>

      {/* FOOTER */}
      <Section title="Footer" hint="Footer attribution toggle.">
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={showPoweredByEtc}
            onChange={(e) => setShowPoweredByEtc(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium text-foreground">
              Show "Powered by ETC"
            </span>
            <span className="block text-muted-foreground">
              Turn off only if your enterprise plan includes the attribution
              removal add-on.
            </span>
          </span>
        </label>
      </Section>

      {/* PREVIEW + ACTIONS */}
      <BrandPreview
        primary={primaryValid ? primary : TENANT_BRAND_DEFAULTS.primaryColor}
        primaryText={
          primaryTextValid ? primaryText : TENANT_BRAND_DEFAULTS.accentColor
        }
        accent={accentValid ? accent : TENANT_BRAND_DEFAULTS.accentColor}
        logoUrl={logoUrl}
        textMark={textMark}
        tenantName={tenantName}
        showPoweredByEtc={showPoweredByEtc}
        footerText={footerText}
      />

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
          {saving
            ? "Saving..."
            : completeOnboardingOnSave
              ? "Save and continue"
              : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs">
      <span className="block font-medium text-foreground">{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-[0.65rem] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
  valid,
}: {
  label: string;
  hint?: string;
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
          aria-label={`${label} swatch`}
          className="h-10 w-12 cursor-pointer rounded-lg border border-input bg-background"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="#000000"
          spellCheck={false}
          aria-label={`${label} hex`}
          className={cn(
            "h-10 w-28 rounded-lg border bg-background px-3 font-mono text-sm",
            valid ? "border-input" : "border-destructive",
          )}
        />
      </div>
      {hint && (
        <span className="mt-1 block text-[0.65rem] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}

function BrandPreview({
  primary,
  primaryText,
  accent,
  logoUrl,
  textMark,
  tenantName,
  showPoweredByEtc,
  footerText,
}: {
  primary: string;
  primaryText: string;
  accent: string;
  logoUrl: string | null;
  textMark: string;
  tenantName: string;
  showPoweredByEtc: boolean;
  footerText: string;
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
          ) : textMark ? (
            <span className="text-sm font-semibold tracking-wider">
              {textMark.toUpperCase()}
            </span>
          ) : (
            <span className="text-sm font-semibold">{tenantName}</span>
          )}
          {showPoweredByEtc && (
            <span className="ml-auto text-[0.6rem] uppercase tracking-wider opacity-70">
              Powered by ETC
            </span>
          )}
        </header>
        <div className="bg-background p-5">
          <h3 className="text-lg font-semibold">Welcome.</h3>
          <p className="mt-2 text-xs text-muted-foreground">
            We'll walk you through a short practice round before the real
            assessment.
          </p>
          <button
            type="button"
            className="mt-4 inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold"
            style={{ background: primary, color: primaryText }}
          >
            Start practice
          </button>
        </div>
        {(footerText || showPoweredByEtc) && (
          <footer className="border-t border-border bg-muted/20 px-4 py-2 text-center text-[0.6rem] text-muted-foreground">
            {footerText || (showPoweredByEtc ? "Powered by ETC" : "")}
          </footer>
        )}
      </div>
    </section>
  );
}

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
