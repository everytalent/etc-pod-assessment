/**
 * GET /api/v1/admin/cutover-dashboard
 *
 * Adminish surface for tracking promo cutover. Returns the active
 * tenant count, launch date, and days-since-launch so ETC staff can
 * eyeball both threshold conditions (70 accounts or 90 days).
 */

import { count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminTierApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { systemConfig, tenants } from "@/lib/db/schema";

const THRESHOLD_TENANTS = 70;
const THRESHOLD_DAYS = 90;

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdminTierApi();
  if (!auth.user) return auth.unauthorized;

  const [tenantCountRow] = await db.select({ n: count() }).from(tenants);
  const [launchRow] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "launch_date_at"))
    .limit(1);
  const [tierRow] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "pricing_tier"))
    .limit(1);

  const activeTenantCount = Number(tenantCountRow?.n ?? 0);
  const launchedAt = launchRow?.valueTimestamp ?? null;
  const daysSinceLaunch = launchedAt
    ? Math.floor((Date.now() - launchedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const tenantThresholdReached = activeTenantCount >= THRESHOLD_TENANTS;
  const daysThresholdReached =
    daysSinceLaunch !== null && daysSinceLaunch >= THRESHOLD_DAYS;

  return NextResponse.json({
    active_tenant_count: activeTenantCount,
    tenant_threshold: THRESHOLD_TENANTS,
    launch_date_at: launchedAt?.toISOString() ?? null,
    days_since_launch: daysSinceLaunch,
    days_threshold: THRESHOLD_DAYS,
    pricing_tier: tierRow?.valueText ?? "launch_promo",
    threshold_reached: tenantThresholdReached || daysThresholdReached,
    recommended_action:
      tenantThresholdReached || daysThresholdReached
        ? "Schedule 30-day pre-cutover notice and prepare standard pricing"
        : "Promo period continues",
  });
}
