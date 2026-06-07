/**
 * GET /api/v1/tenant/billing/catalog
 *
 * Returns the pricing options visible to the requesting tenant (driven
 * by their locked pricing tier). The UI uses this to render the
 * TopUpDialog + payment gate without baking pricing into the front-end.
 */

import { NextResponse } from "next/server";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { getCatalog } from "@/lib/tenant/billing/catalog";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;
  const cat = getCatalog(auth.session.tenant.pricingTier);
  return NextResponse.json(
    serialiseForTenant({
      tier: auth.session.tenant.pricingTier,
      currency: cat.currency,
      trial: cat.trial,
      pay_as_you_go: cat.payAsYouGo,
      slot_top_ups: cat.slotTopUps,
      subscriptions: cat.subscriptions,
      footer_removal: cat.footerRemoval,
    }),
  );
}
