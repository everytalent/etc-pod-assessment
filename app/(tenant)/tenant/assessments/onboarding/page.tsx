/**
 * First-run tenant onboarding (PRD §0).
 *
 * Renders the 4-card explainer, then the brand customiser. On save the
 * branding API stamps onboarding_completed_at and we redirect to the
 * intake form (Phase 2 will land /tenant/assessments/new; until then we
 * land back on the dashboard).
 *
 * If onboarding is already complete, this page redirects to the
 * dashboard so the carousel never reappears unless the user explicitly
 * navigates to /tenant/settings/branding.
 */

import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { getTenantBrand } from "@/lib/tenant/branding";

import { OnboardingClient } from "./OnboardingClient";

export const dynamic = "force-dynamic";

export default async function TenantOnboardingPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const brand = await getTenantBrand(session.tenant.id);
  if (brand.onboardingCompletedAt) redirect("/tenant");

  return (
    <OnboardingClient
      tenantName={session.tenant.name}
      initialPrimary={brand.primaryColor}
      initialAccent={brand.accentColor}
      initialLogoUrl={brand.logoUrl}
    />
  );
}
