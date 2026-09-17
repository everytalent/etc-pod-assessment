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

/**
 * Only same-origin relative paths are accepted as a destination. Taking an
 * arbitrary ?next= would turn this page into an open redirect, so anything
 * that is not a plain "/path" is discarded rather than sanitised.
 */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith("/") || next.startsWith("//")) return undefined;
  return next;
}

export default async function TenantOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const { next } = await searchParams;
  const destination = safeNext(next);

  const brand = await getTenantBrand(session.tenant.id);
  if (brand.onboardingCompletedAt) redirect(destination ?? "/tenant");

  return (
    <OnboardingClient
      tenantName={session.tenant.name}
      initialPrimary={brand.primaryColor}
      initialAccent={brand.accentColor}
      initialLogoUrl={brand.logoUrl}
      next={destination}
    />
  );
}
