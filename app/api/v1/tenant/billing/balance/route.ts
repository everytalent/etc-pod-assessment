import { NextResponse } from "next/server";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { getBalance } from "@/lib/tenant/billing/balance";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;
  const balance = await getBalance(auth.session.tenant.id);
  return NextResponse.json(
    serialiseForTenant({
      generation_credits: balance?.generationCredits ?? 0,
      candidate_slots: balance?.candidateSlots ?? 0,
      trial_consumed: balance?.trialConsumed ?? false,
      footer_removal_active: balance?.footerRemovalActive ?? false,
      footer_removal_expires_at:
        balance?.footerRemovalExpiresAt?.toISOString() ?? null,
    }),
  );
}
