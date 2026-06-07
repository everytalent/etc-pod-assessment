/**
 * GET / PUT /api/v1/tenant/settings
 * Body (PUT): { default_link_expiry_days: 7..180 }
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi, requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantSettings } from "@/lib/db/schema";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const DEFAULT_EXPIRY_DAYS = 30;

export async function GET(): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;
  const [row] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, auth.session.tenant.id))
    .limit(1);
  return NextResponse.json(
    serialiseForTenant({
      default_link_expiry_days: row?.defaultLinkExpiryDays ?? DEFAULT_EXPIRY_DAYS,
    }),
  );
}

const putSchema = z.object({
  default_link_expiry_days: z.number().int().min(7).max(180),
});

export async function PUT(req: Request): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;
  let parsed;
  try {
    parsed = putSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const [existing] = await db
    .select()
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, auth.session.tenant.id))
    .limit(1);
  if (existing) {
    await db
      .update(tenantSettings)
      .set({
        defaultLinkExpiryDays: parsed.default_link_expiry_days,
        updatedAt: new Date(),
      })
      .where(eq(tenantSettings.tenantId, auth.session.tenant.id));
  } else {
    await db.insert(tenantSettings).values({
      tenantId: auth.session.tenant.id,
      defaultLinkExpiryDays: parsed.default_link_expiry_days,
    });
  }
  return NextResponse.json(
    serialiseForTenant({
      ok: true,
      default_link_expiry_days: parsed.default_link_expiry_days,
    }),
  );
}
