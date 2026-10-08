/**
 * One credit covers everything.
 *
 * A workspace whose plan on the platform is unlimited (Every Talent Co's
 * own, and any the company marks so) is never charged here: the payment
 * gate passes and no credit or slot is consumed. The answer comes from the
 * platform's entitlement, matched by tenant name (the name is what the
 * hand-off and the internal bank builder use to find the tenant here), and
 * Every Talent Co itself is always unlimited even if the platform cannot
 * be reached.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";

const PLATFORM_API = (process.env.PLATFORM_API_URL ?? "https://app.everytalentco.com/api").replace(/\/+$/, "");
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; unlimited: boolean }>();

function alwaysUnlimitedNames(): string[] {
  return (process.env.UNLIMITED_TENANT_NAMES ?? "Every Talent Co,Every Talent Company,Energy Talent Co")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function isUnlimitedTenant(tenantId: string): Promise<boolean> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.unlimited;
  let unlimited = false;
  try {
    const [row] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const name = (row?.name ?? "").trim();
    if (name && alwaysUnlimitedNames().includes(name.toLowerCase())) {
      unlimited = true;
    } else if (name) {
      unlimited = await platformSaysUnlimited(name);
    }
  } catch (err) {
    console.warn(`[billing] unlimited check failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
  cache.set(tenantId, { at: Date.now(), unlimited });
  return unlimited;
}

async function platformSaysUnlimited(tenantName: string): Promise<boolean> {
  const token = (process.env.ETC_ASSESSMENT_SERVICE_TOKEN ?? "").trim();
  if (!token) return false;
  try {
    const res = await fetch(`${PLATFORM_API}/internal/entitlement?tenant_name=${encodeURIComponent(tenantName)}`, {
      headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => ({}))) as { unlimited?: boolean };
    return body.unlimited === true;
  } catch {
    return false;
  }
}
