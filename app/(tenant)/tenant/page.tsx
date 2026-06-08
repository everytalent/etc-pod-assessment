/**
 * Tenant home — gated dashboard placeholder. Phase 1 wires real content;
 * Phase 0 just proves the auth boundary and renders a welcome.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { getTenantBrand } from "@/lib/tenant/branding";
import { TenantThemeProvider } from "@/components/tenant/TenantThemeProvider";
import { OnboardingModal } from "@/components/tenant/OnboardingModal";

export const dynamic = "force-dynamic";

export default async function TenantHomePage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  const brand = await getTenantBrand(session.tenant.id);
  const showOnboarding = !brand.onboardingCompletedAt;

  return (
    <TenantThemeProvider brand={brand} className="contents">
      <TenantHomeInner
        tenantName={session.tenant.name}
        countryCode={session.tenant.countryCode}
        currencyCode={session.tenant.currencyCode}
        pricingTier={session.tenant.pricingTier}
      />
      {showOnboarding && (
        <OnboardingModal
          tenantName={session.tenant.name}
          initialPrimary={brand.primaryColor}
          initialAccent={brand.accentColor}
          initialLogoUrl={brand.logoUrl}
        />
      )}
    </TenantThemeProvider>
  );
}

function TenantHomeInner({
  tenantName,
  countryCode,
  currencyCode,
  pricingTier,
}: {
  tenantName: string;
  countryCode: string;
  currencyCode: string;
  pricingTier: string;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {tenantName}.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your workspace is ready. Create an assessment to get started.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <article className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold">Workspace details</h2>
          <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <dt>Country</dt>
              <dd className="text-foreground">{countryCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Currency</dt>
              <dd className="text-foreground">{currencyCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Pricing tier</dt>
              <dd className="text-foreground">{pricingTier}</dd>
            </div>
          </dl>
          <Link
            href="/tenant/settings/branding"
            className="mt-4 inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium hover:border-etc-marigold"
          >
            Update branding
          </Link>
        </article>

        <article className="rounded-2xl border border-dashed border-border bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Coming soon</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Assessment creation, candidate results, and billing land in the
            next phases of the rollout.
          </p>
        </article>
      </div>
    </section>
  );
}
