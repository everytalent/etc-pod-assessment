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
  logoUrl: string | null;
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
      logoUrl: TENANT_BRAND_DEFAULTS.logoUrl,
      onboardingCompletedAt: null,
    };
  }
  return {
    primaryColor: row.primaryColor,
    accentColor: row.accentColor,
    logoUrl: row.logoUrl,
    onboardingCompletedAt: row.onboardingCompletedAt,
  };
}

export type SaveTenantBrandInput = {
  tenantId: string;
  updatedByUserId: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
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

  const primaryColor =
    input.primaryColor ??
    existing?.primaryColor ??
    TENANT_BRAND_DEFAULTS.primaryColor;
  const accentColor =
    input.accentColor ??
    existing?.accentColor ??
    TENANT_BRAND_DEFAULTS.accentColor;
  const logoUrl =
    input.logoUrl !== undefined ? input.logoUrl : existing?.logoUrl ?? null;
  const onboardingCompletedAt = input.completeOnboarding
    ? new Date()
    : existing?.onboardingCompletedAt ?? null;

  if (existing) {
    await db
      .update(tenantAssessmentBranding)
      .set({
        primaryColor,
        accentColor,
        logoUrl,
        onboardingCompletedAt,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(tenantAssessmentBranding.tenantId, input.tenantId));
  } else {
    await db.insert(tenantAssessmentBranding).values({
      tenantId: input.tenantId,
      primaryColor,
      accentColor,
      logoUrl,
      onboardingCompletedAt,
      updatedByUserId: input.updatedByUserId,
    });
  }

  return {
    ok: true,
    brand: {
      primaryColor,
      accentColor,
      logoUrl,
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
    logoUrl: TENANT_BRAND_DEFAULTS.logoUrl,
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
