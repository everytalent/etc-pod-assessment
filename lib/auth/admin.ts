/**
 * Admin auth helpers — used inside Server Components and API routes.
 *
 * The middleware already refreshes tokens and gates routes; these helpers
 * are a defence-in-depth check directly against Supabase. Always prefer
 * these over reading cookies by hand.
 */

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAdminUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

/**
 * For API routes — returns either { user } or { unauthorized: NextResponse }.
 * Caller pattern:
 *   const auth = await requireAdminApi();
 *   if (!auth.user) return auth.unauthorized;
 *   // ...use auth.user
 */
export async function requireAdminApi() {
  const user = await getAdminUser();
  if (!user) {
    return {
      user: null,
      unauthorized: NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      ),
    } as const;
  }
  return { user, unauthorized: null } as const;
}
