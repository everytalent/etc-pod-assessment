/**
 * Auth-callback route — Supabase magic-link / invite landing.
 *
 * Accepts two shapes from the email link:
 *
 *   ?token_hash=…&type=invite|magiclink|recovery|signup
 *     Verified server-side via verifyOtp. Used for invites because they
 *     have no PKCE verifier in the invitee's browser (the verifier would
 *     have been in the inviting admin's browser, if anywhere).
 *
 *   ?code=…
 *     PKCE auth code from the standard signInWithOtp flow. Exchanged via
 *     exchangeCodeForSession, which needs the verifier cookie set when
 *     "Send magic link" was clicked in the same browser.
 *
 * After either path establishes a session, we enforce the admin_users
 * allowlist. If the verified email isn't allow-listed, we sign the user
 * out and bounce them to /admin/login?error=not_authorized so they never
 * see /admin chrome.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";
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
  const next = url.searchParams.get("next") || "/admin";

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type && VERIFY_OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      // Cast: Supabase's union type is narrower than what we accept here,
      // but verifyOtp accepts every value in VERIFY_OTP_TYPES at runtime.
      type: type as "invite" | "magiclink" | "recovery" | "signup" | "email" | "email_change",
    });
    if (error) {
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  }

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
      await supabase.auth.signOut();
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", "not_authorized");
      return NextResponse.redirect(back);
    }
  }

  return NextResponse.redirect(new URL(next, url));
}
