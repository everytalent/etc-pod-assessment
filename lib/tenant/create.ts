/**
 * Tenant creation helper — handles the full provisioning sequence:
 *
 *   1. Insert the tenants row (country -> currency + pricing_tier via
 *      lib/tenant/country.ts)
 *   2. Insert the first tenant_user as the workspace owner
 *   3. Provision the free trial credits + slots (region-aware via
 *      lib/tenant/billing/catalog.ts)
 *
 * Used by the bootstrap CLI (scripts/create-tenant.ts) and (eventually)
 * the public signup form. Transactional so a partial failure rolls
 * back cleanly.
 */

import { db } from "@/lib/db/client";
import {
  tenants,
  tenantUsers,
  type TenantRole,
} from "@/lib/db/schema";

import { getCatalog } from "./billing/catalog";
import { provisionTrialBalance } from "./billing/balance";
import { resolveTenantCountry, type SupportedCountryCode } from "./country";

export type CreateTenantInput = {
  name: string;
  countryCode: SupportedCountryCode;
  ownerEmail: string;
};

export type CreateTenantResult = {
  tenantId: string;
  ownerUserId: string;
};

export async function createTenant(
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  const country = resolveTenantCountry(input.countryCode);
  if (!country) {
    throw new Error(`Unsupported country: ${input.countryCode}`);
  }

  // Insert tenant + owner in a transaction so they commit atomically.
  const { tenantId, ownerUserId } = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        name: input.name.trim(),
        countryCode: country.countryCode,
        currencyCode: country.currencyCode,
        pricingTier: country.pricingTier,
      })
      .returning({ id: tenants.id });

    const [owner] = await tx
      .insert(tenantUsers)
      .values({
        tenantId: tenant.id,
        email: input.ownerEmail.trim().toLowerCase(),
        role: "owner" as TenantRole,
      })
      .returning({ id: tenantUsers.id });

    return { tenantId: tenant.id, ownerUserId: owner.id };
  });

  // Trial balance lives in a follow-up transaction so it can see the
  // freshly-committed tenant row. If it fails, the tenant + owner still
  // exist; provisionTrialBalance is idempotent so a retry is safe.
  const catalog = getCatalog(country.pricingTier);
  await provisionTrialBalance({
    tenantId,
    generationCredits: catalog.trial.generationCredits,
    candidateSlots: catalog.trial.candidateSlots,
  });

  return { tenantId, ownerUserId };
}
