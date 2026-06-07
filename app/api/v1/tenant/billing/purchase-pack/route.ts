/**
 * POST /api/v1/tenant/billing/purchase-pack
 * Body: { pack_id: string }
 *
 * Charges the tenant's card-on-file (or simulates when
 * TENANT_BILLING_SIMULATE=1) and applies the pack's deltas.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi } from "@/lib/auth/tenant";
import { purchasePack } from "@/lib/tenant/billing/purchase";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const schema = z.object({ pack_id: z.string().min(2).max(80) });

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;

  let parsed;
  try {
    parsed = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const result = await purchasePack({
    tenant: auth.session.tenant,
    packId: parsed.pack_id,
    simulateSuccess: process.env.TENANT_BILLING_SIMULATE === "1",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "payment_failed" ? 402 : 400 },
    );
  }

  const { ok: _ok, ...rest } = result;
  void _ok;
  return NextResponse.json(serialiseForTenant({ ok: true, ...rest }));
}
