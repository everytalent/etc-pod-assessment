import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantBillingLedger } from "@/lib/db/schema";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), 200);

  const rows = await db
    .select()
    .from(tenantBillingLedger)
    .where(eq(tenantBillingLedger.tenantId, auth.session.tenant.id))
    .orderBy(desc(tenantBillingLedger.createdAt))
    .limit(limit);

  return NextResponse.json(
    serialiseForTenant({
      entries: rows.map((r) => ({
        id: r.id,
        event_type: r.eventType,
        generation_credits_delta: r.generationCreditsDelta,
        candidate_slots_delta: r.candidateSlotsDelta,
        amount_local: r.amountLocal,
        currency_code: r.currencyCode,
        reason: r.reason,
        payment_processor: r.paymentProcessor,
        payment_processor_ref: r.paymentProcessorRef,
        created_at: r.createdAt.toISOString(),
      })),
    }),
  );
}
