/**
 * POST /api/v1/admin/system-config/pricing-tier
 * Body: { value: 'launch_promo' | 'standard', reason?: string }
 *
 * Superadmin-only flip from launch_promo to standard. Existing balances
 * retain their price-lock (the ledger captures pricing_tier_at_purchase
 * per row).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { systemConfig } from "@/lib/db/schema";

const schema = z.object({
  value: z.enum(["launch_promo", "standard"]),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
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

  await db
    .update(systemConfig)
    .set({
      valueText: parsed.value,
      updatedBy: auth.session.admin.id,
      updatedAt: new Date(),
    })
    .where(eq(systemConfig.key, "pricing_tier"));

  return NextResponse.json({ ok: true, pricing_tier: parsed.value });
}
