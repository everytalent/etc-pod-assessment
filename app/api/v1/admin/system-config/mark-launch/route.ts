/**
 * POST /api/v1/admin/system-config/mark-launch
 *
 * Superadmin-only. Stamps system_config.launch_date_at = now() so the
 * 3-month promo clock starts. Idempotent at first call; subsequent
 * calls return 409 (PRD §7a — change requires Simeon approval, which
 * for v1 means "go to psql").
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { systemConfig } from "@/lib/db/schema";

export async function POST(): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const [existing] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "launch_date_at"))
    .limit(1);

  if (existing?.valueTimestamp) {
    return NextResponse.json(
      {
        error: "already_marked",
        launch_date_at: existing.valueTimestamp.toISOString(),
      },
      { status: 409 },
    );
  }

  const now = new Date();
  if (existing) {
    await db
      .update(systemConfig)
      .set({
        valueTimestamp: now,
        updatedBy: auth.session.admin.id,
        updatedAt: now,
      })
      .where(eq(systemConfig.key, "launch_date_at"));
  } else {
    await db.insert(systemConfig).values({
      key: "launch_date_at",
      valueTimestamp: now,
      updatedBy: auth.session.admin.id,
    });
  }

  return NextResponse.json({ ok: true, launch_date_at: now.toISOString() });
}
