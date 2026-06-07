/**
 * Tenant home — gated dashboard placeholder. Phase 1 wires real content;
 * Phase 0 just proves the auth boundary and renders a welcome.
 */

import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";

export const dynamic = "force-dynamic";

export default async function TenantHomePage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome, {session.tenant.name}.</h1>
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
              <dd className="text-foreground">{session.tenant.countryCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Currency</dt>
              <dd className="text-foreground">{session.tenant.currencyCode}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Pricing tier</dt>
              <dd className="text-foreground">{session.tenant.pricingTier}</dd>
            </div>
          </dl>
        </article>

        <article className="rounded-2xl border border-dashed border-border bg-card/40 p-5">
          <h2 className="text-sm font-semibold">Coming soon</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Brand customisation, assessment creation, candidate results, and
            billing land in the next phases of the rollout.
          </p>
        </article>
      </div>
    </section>
  );
}
