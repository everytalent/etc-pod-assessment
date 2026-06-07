/**
 * Brand customisation — settings update path (no explainer cards).
 * Available to admin+ tenant users at any time after onboarding.
 */

import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { hasTenantRoleAtLeast } from "@/lib/auth/tenant";
import { getTenantBrand } from "@/lib/tenant/branding";

import { SettingsBrandingClient } from "./SettingsBrandingClient";

export const dynamic = "force-dynamic";

export default async function TenantSettingsBrandingPage() {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");
  if (!hasTenantRoleAtLeast(session.tenantUser.role, "admin")) {
    redirect("/tenant");
  }

  const brand = await getTenantBrand(session.tenant.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Workspace branding</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Update the colours and logo your candidates see.
        </p>
      </header>
      <SettingsBrandingClient
        tenantName={session.tenant.name}
        initialPrimary={brand.primaryColor}
        initialAccent={brand.accentColor}
        initialLogoUrl={brand.logoUrl}
      />
    </div>
  );
}
