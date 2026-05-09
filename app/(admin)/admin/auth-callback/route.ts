/**
 * Auth-callback route — Supabase magic-link landing.
 *
 * Exchanges the ?code= for a session, then enforces the admin_users
 * allowlist. If the verified email isn't in the allowlist, we sign the user
 * out and bounce them back to /admin/login?error=not_authorized — they
 * never see /admin chrome.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/admin";

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  }

  // Allowlist check — defence-in-depth on top of Supabase auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    const [admin] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, user.email.toLowerCase()))
      .limit(1);

    if (!admin) {
      // Sign out so a refresh on /admin doesn't bounce the same person back.
      await supabase.auth.signOut();
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", "not_authorized");
      return NextResponse.redirect(back);
    }
  }

  return NextResponse.redirect(new URL(next, url));
}
