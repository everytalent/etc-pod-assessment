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

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const putSchema = z.object({
  primary_color: hex.optional(),
  accent_color: hex.optional(),
  primary_text_color: hex.optional(),
  logo_url: z.string().url().nullable().optional(),
  text_mark: z.string().max(4).nullable().optional(),
  support_email: z.string().email().max(200).nullable().optional(),
  company_url: z.string().url().max(300).nullable().optional(),
  footer_text: z.string().max(200).nullable().optional(),
  contact_email: z.string().email().max(200).nullable().optional(),
  contact_phone: z.string().max(40).nullable().optional(),
  show_powered_by_etc: z.boolean().optional(),
  complete_onboarding: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;

  const brand = await getTenantBrand(auth.session.tenant.id);
  return NextResponse.json(serialiseForTenant(brandToPayload(brand)));
}

function brandToPayload(brand: Awaited<ReturnType<typeof getTenantBrand>>) {
  return {
    primary_color: brand.primaryColor,
    accent_color: brand.accentColor,
    primary_text_color: brand.primaryTextColor,
    logo_url: brand.logoUrl,
    text_mark: brand.textMark,
    support_email: brand.supportEmail,
    company_url: brand.companyUrl,
    footer_text: brand.footerText,
    contact_email: brand.contactEmail,
    contact_phone: brand.contactPhone,
    show_powered_by_etc: brand.showPoweredByEtc,
    onboarding_completed_at:
      brand.onboardingCompletedAt?.toISOString() ?? null,
  };
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
    primaryTextColor: parsed.primary_text_color,
    logoUrl: parsed.logo_url,
    textMark: parsed.text_mark,
    supportEmail: parsed.support_email,
    companyUrl: parsed.company_url,
    footerText: parsed.footer_text,
    contactEmail: parsed.contact_email,
    contactPhone: parsed.contact_phone,
    showPoweredByEtc: parsed.show_powered_by_etc,
    completeOnboarding: parsed.complete_onboarding,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(
    serialiseForTenant({ ok: true, ...brandToPayload(result.brand) }),
  );
}
