/**
 * Tenant auth-callback — Supabase magic-link / invite landing for the
 * tenant-facing surface. Mirrors app/(admin)/admin/auth-callback/route.ts
 * but enforces the `tenant_users` allowlist instead of `admin_users`.
 *
 * The two callbacks are intentionally separate so a tenant invite link
 * can't accidentally land someone on /admin and an admin invite link
 * can't accidentally land them on /tenant. Same Supabase project, two
 * distinct allowlists.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { tenantUsers } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERIFY_OTP_TYPES = new Set([
  "invite",
  "magiclink",
  "recovery",
  "signup",
  "email",
  "email_change",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const next = url.searchParams.get("next") || "/tenant";

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type && VERIFY_OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as "invite" | "magiclink" | "recovery" | "signup" | "email" | "email_change",
    });
    if (error) {
      const back = new URL("/tenant/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const back = new URL("/tenant/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    const [row] = await db
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(eq(tenantUsers.email, user.email.toLowerCase()))
      .limit(1);

    if (!row) {
      await supabase.auth.signOut();
      const back = new URL("/tenant/login", url);
      back.searchParams.set("error", "not_authorized");
      return NextResponse.redirect(back);
    }
  }

  return NextResponse.redirect(new URL(next, url));
}
