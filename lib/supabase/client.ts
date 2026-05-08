/**
 * Supabase browser client — used inside Client Components for auth flows
 * (admin magic link). Candidate UI does not use this; it talks to our /api
 * routes which carry the candidate session cookie (lib/session.ts).
 */

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.",
    );
  }
  return createBrowserClient(url, anon);
}
