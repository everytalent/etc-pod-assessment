/**
 * GET  /api/v1/tenant/branding — current tenant's brand (returns defaults
 *                                if no row yet).
 * PUT  /api/v1/tenant/branding — update primary, accent, logo URL, and
 *                                optionally stamp onboarding_completed_at.
 *
 * Admin-tier required (TENANT_CAN.manageBranding). Member-tier can read
 * via GET if needed in the future, but for v1 we gate both with the same
 * tier for simplicity.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi } from "@/lib/auth/tenant";
import { getTenantBrand, saveTenantBrand } from "@/lib/tenant/branding";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const putSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  logo_url: z.string().url().nullable().optional(),
  complete_onboarding: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;

  const brand = await getTenantBrand(auth.session.tenant.id);
  return NextResponse.json(
    serialiseForTenant({
      primary_color: brand.primaryColor,
      accent_color: brand.accentColor,
      logo_url: brand.logoUrl,
      onboarding_completed_at: brand.onboardingCompletedAt?.toISOString() ?? null,
    }),
  );
}

export async function PUT(req: Request): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;

  let parsed;
  try {
    parsed = putSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await saveTenantBrand({
    tenantId: auth.session.tenant.id,
    updatedByUserId: auth.session.tenantUser.id,
    primaryColor: parsed.primary_color,
    accentColor: parsed.accent_color,
    logoUrl: parsed.logo_url,
    completeOnboarding: parsed.complete_onboarding,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    serialiseForTenant({
      ok: true,
      primary_color: result.brand.primaryColor,
      accent_color: result.brand.accentColor,
      logo_url: result.brand.logoUrl,
      onboarding_completed_at:
        result.brand.onboardingCompletedAt?.toISOString() ?? null,
    }),
  );
}
