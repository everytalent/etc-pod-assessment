/**
 * GET /api/auth/platform-handoff?token=…&next=/tenant
 *
 * One sign-in across engines. The platform at app.everytalentco.com sends a
 * signed-in person here with a short-lived token for who they are and which
 * workspace they are in, signed with ETC_ASSESSMENT_SERVICE_TOKEN, the
 * secret this engine already shares with the platform. We verify it, make
 * sure the person exists here (tenant by name, as the internal tenant-banks
 * route does; a tenant_users row; a Supabase user), mint a one-time
 * magic-link token for them and send them through the normal tenant
 * callback, so the session that results is an ordinary tenant session.
 *
 * The platform is trusted for membership: it is the system that knows which
 * company the person belongs to. Nothing here bypasses the allowlist; it
 * fills it in from the platform's answer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { db as dbAdmin } from "@/lib/db/client";
import { tenantUsers, tenants } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

interface HandoffPayload {
  email: string;
  tenant_id: string;
  tenant_name: string;
  staff?: boolean;
  iat: number;
  exp: number;
  nonce: string;
}

function verifyToken(token: string): HandoffPayload | null {
  const secret = (process.env.ETC_ASSESSMENT_SERVICE_TOKEN ?? "").trim();
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HandoffPayload;
    if (!payload.email || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function back(url: URL, error: string): NextResponse {
  const login = new URL("/tenant/login", url);
  login.searchParams.set("error", error);
  return NextResponse.redirect(login);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const nextRaw = url.searchParams.get("next") ?? "/tenant";
  const next = /^\/(?!\/)[^\s]*$/.test(nextRaw) ? nextRaw : "/tenant";

  const payload = verifyToken(token);
  if (!payload) return back(url, "handoff_invalid");

  const email = payload.email.trim().toLowerCase();

  // The tenant, by name, created if this company has never used assessments.
  const all = await dbAdmin.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const wanted = (payload.tenant_name || "Every Talent Co").trim();
  let tenant = all.find((t: { id: string; name: string }) => t.name.trim().toLowerCase() === wanted.toLowerCase());
  let createdTenant = false;
  if (!tenant) {
    const [row] = await dbAdmin
      .insert(tenants)
      .values({ name: wanted, countryCode: "NG", currencyCode: "NGN", pricingTier: "nigeria" })
      .returning({ id: tenants.id, name: tenants.name });
    tenant = row;
    createdTenant = true;
  }

  // The person on the allowlist. Email is unique here, so a row that points
  // at another tenant is moved: the platform knows which company this person
  // works in, and a stale row is exactly what made their own candidates 404.
  const [existingUser] = await dbAdmin.select({ id: tenantUsers.id, tenantId: tenantUsers.tenantId }).from(tenantUsers).where(eq(tenantUsers.email, email)).limit(1);
  if (!existingUser) {
    await dbAdmin.insert(tenantUsers).values({ tenantId: tenant.id, email, role: createdTenant ? "owner" : "admin" });
  } else if (existingUser.tenantId !== tenant.id) {
    await dbAdmin.update(tenantUsers).set({ tenantId: tenant.id, updatedAt: new Date() }).where(eq(tenantUsers.id, existingUser.id));
  }

  // A Supabase user, and a one-time token to sign them in with.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return back(url, "handoff_not_configured");
  const admin = createClient(supaUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error && /not found|does not exist/i.test(link.error.message)) {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) return back(url, "handoff_user_failed");
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) return back(url, "handoff_link_failed");

  const callback = new URL("/tenant/auth-callback", url);
  callback.searchParams.set("token_hash", tokenHash);
  callback.searchParams.set("type", "magiclink");
  callback.searchParams.set("next", next);
  return NextResponse.redirect(callback);
}
