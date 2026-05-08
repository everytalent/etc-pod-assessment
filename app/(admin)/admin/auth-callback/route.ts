/**
 * Auth-callback route — Supabase magic-link landing.
 *
 * Exchanges the ?code= for a session via supabase.auth.exchangeCodeForSession,
 * which sets the auth cookies. Then redirects to ?next= (defaults to /admin).
 */

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/admin";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const back = new URL("/admin/login", url);
      back.searchParams.set("error", error.message);
      return NextResponse.redirect(back);
    }
  }

  return NextResponse.redirect(new URL(next, url));
}
