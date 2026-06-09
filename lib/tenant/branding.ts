/**
 * Tenant branding repository — server-side reads/writes for
 * tenant_assessment_branding. Used by the tenant admin onboarding +
 * settings surfaces AND by the candidate runner to skin candidate UI.
 *
 * Two important rules:
 *   1. Reads always return a row. If the tenant has no row yet, we
 *      synthesise ETC defaults (TENANT_BRAND_DEFAULTS) instead of
 *      returning null. Callers never have to handle the empty case.
 *   2. Writes validate hex format server-side. The colour pickers in
 *      the UI also validate, but the server is the source of truth.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  tenantAssessmentBranding,
  TENANT_BRAND_DEFAULTS,
} from "@/lib/db/schema";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export type TenantBrand = {
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
  onboardingCompletedAt: Date | null;
};

/**
 * Always returns a brand. If no row exists yet, returns defaults with
 * `onboardingCompletedAt = null` so the caller can drive the first-run
 * carousel off that signal.
 */
export async function getTenantBrand(tenantId: string): Promise<TenantBrand> {
  const [row] = await db
    .select()
    .from(tenantAssessmentBranding)
    .where(eq(tenantAssessmentBranding.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return {
      primaryColor: TENANT_BRAND_DEFAULTS.primaryColor,
      accentColor: TENANT_BRAND_DEFAULTS.accentColor,
      primaryTextColor: TENANT_BRAND_DEFAULTS.accentColor,
      logoUrl: TENANT_BRAND_DEFAULTS.logoUrl,
      textMark: null,
      supportEmail: null,
      companyUrl: null,
      footerText: null,
      contactEmail: null,
      contactPhone: null,
      showPoweredByEtc: true,
      onboardingCompletedAt: null,
    };
  }
  return {
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    primaryTextColor: row.primaryTextColor,
    logoUrl: row.logoUrl,
    textMark: row.textMark,
    supportEmail: row.supportEmail,
    companyUrl: row.companyUrl,
    footerText: row.footerText,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    showPoweredByEtc: row.showPoweredByEtc,
    onboardingCompletedAt: row.onboardingCompletedAt,
  };
}

export type SaveTenantBrandInput = {
  tenantId: string;
  updatedByUserId: string;
  primaryColor?: string;
  accentColor?: string;
  primaryTextColor?: string;
  logoUrl?: string | null;
  textMark?: string | null;
  supportEmail?: string | null;
  companyUrl?: string | null;
  footerText?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  showPoweredByEtc?: boolean;
  completeOnboarding?: boolean;
};

export type SaveTenantBrandResult =
  | { ok: true; brand: TenantBrand }
  | { ok: false; error: string };

export async function saveTenantBrand(
  input: SaveTenantBrandInput,
): Promise<SaveTenantBrandResult> {
  if (input.primaryColor && !HEX_RE.test(input.primaryColor)) {
    return { ok: false, error: "primary_color must be #RRGGBB hex" };
  }
  if (input.accentColor && !HEX_RE.test(input.accentColor)) {
    return { ok: false, error: "accent_color must be #RRGGBB hex" };
  }

  const [existing] = await db
    .select()
    .from(tenantAssessmentBranding)
    .where(eq(tenantAssessmentBranding.tenantId, input.tenantId))
    .limit(1);

  const pick = <T,>(incoming: T | undefined, current: T | undefined, fallback: T): T =>
    incoming !== undefined ? incoming : current ?? fallback;
  const pickNullable = <T,>(
    incoming: T | null | undefined,
    current: T | null | undefined,
  ): T | null =>
    incoming !== undefined ? (incoming ?? null) : (current ?? null);

  const primaryColor = pick(
    input.primaryColor,
    existing?.primaryColor,
    TENANT_BRAND_DEFAULTS.primaryColor,
  );
  const accentColor = pick(
    input.accentColor,
    existing?.accentColor,
    TENANT_BRAND_DEFAULTS.accentColor,
  );
  const primaryTextColor = pick(
    input.primaryTextColor,
    existing?.primaryTextColor,
    TENANT_BRAND_DEFAULTS.accentColor,
  );
  const logoUrl = pickNullable(input.logoUrl, existing?.logoUrl);
  const textMark = pickNullable(input.textMark, existing?.textMark);
  const supportEmail = pickNullable(input.supportEmail, existing?.supportEmail);
  const companyUrl = pickNullable(input.companyUrl, existing?.companyUrl);
  const footerText = pickNullable(input.footerText, existing?.footerText);
  const contactEmail = pickNullable(input.contactEmail, existing?.contactEmail);
  const contactPhone = pickNullable(input.contactPhone, existing?.contactPhone);
  const showPoweredByEtc = pick(
    input.showPoweredByEtc,
    existing?.showPoweredByEtc,
    true,
  );
  const onboardingCompletedAt = input.completeOnboarding
    ? new Date()
    : existing?.onboardingCompletedAt ?? null;

  const values = {
    primaryColor,
    accentColor,
    primaryTextColor,
    logoUrl,
    textMark,
    supportEmail,
    companyUrl,
    footerText,
    contactEmail,
    contactPhone,
    showPoweredByEtc,
    onboardingCompletedAt,
    updatedByUserId: input.updatedByUserId,
  };

  if (existing) {
    await db
      .update(tenantAssessmentBranding)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(tenantAssessmentBranding.tenantId, input.tenantId));
  } else {
    await db
      .insert(tenantAssessmentBranding)
      .values({ tenantId: input.tenantId, ...values });
  }

  return {
    ok: true,
    brand: {
      primaryColor,
      accentColor,
      primaryTextColor,
      logoUrl,
      textMark,
      supportEmail,
      companyUrl,
      footerText,
      contactEmail,
      contactPhone,
      showPoweredByEtc,
      onboardingCompletedAt,
    },
  };
}

/**
 * Resolve the brand for the assessment behind a candidate token. The
 * candidate runner calls this to skin the runner UI in tenant colours.
 *
 * Phase 1 doesn't yet link assessments to tenants in the DB (that
 * arrives in Phase 2 via tenant_assessment_bank). For now this is a
 * stub that always returns ETC defaults; Phase 2 will wire the
 * lookup through tenant_assessment_bank.tenant_id.
 */
export async function getBrandForAssessmentToken(
  _token: string,
): Promise<TenantBrand> {
  return {
    primaryColor: TENANT_BRAND_DEFAULTS.primaryColor,
    accentColor: TENANT_BRAND_DEFAULTS.accentColor,
    primaryTextColor: TENANT_BRAND_DEFAULTS.accentColor,
    logoUrl: TENANT_BRAND_DEFAULTS.logoUrl,
    textMark: null,
    supportEmail: null,
    companyUrl: null,
    footerText: null,
    contactEmail: null,
    contactPhone: null,
    showPoweredByEtc: true,
    onboardingCompletedAt: null,
  };
}

/**
 * Adapter for the candidate runner: returns just the CSS-variable
 * payload so a Server Component can inline it.
 */
export function brandToCssVars(brand: TenantBrand): Record<string, string> {
  return {
    "--tenant-primary": brand.primaryColor,
    "--tenant-accent": brand.accentColor,
  };
}

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}
