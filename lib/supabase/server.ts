/**
 * Supabase server client — used inside route handlers and Server Components.
 *
 * Authenticates with the user's Supabase session cookies via @supabase/ssr.
 * Reserved for the admin track (magic-link auth in /admin-ui). The candidate
 * track uses our own httpOnly cookie (lib/session.ts) plus Drizzle directly.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.",
    );
  }

  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components can't mutate cookies — no-op is correct here.
        }
      },
    },
  });
}
