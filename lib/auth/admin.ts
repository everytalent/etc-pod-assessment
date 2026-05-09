/**
 * Admin auth helpers — Server Components + API routes.
 *
 * Two-layer auth:
 *   1. Supabase magic-link verifies the email (via /admin/auth-callback).
 *   2. The email must also exist in the `admin_users` allowlist table.
 *
 * If a candidate emails their way through Supabase but isn't on the
 * allowlist, the auth-callback signs them out before they ever land on
 * /admin. These helpers are the second-line check inside server code.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminUsers, type AdminUser } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminSession = {
  authUserId: string;
  email: string;
  admin: AdminUser;
};

/**
 * Returns the joined Supabase user + admin_users row, or null if either is
 * missing. `null` means "treat as unauthenticated" — caller should redirect
 * or 401.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;

  const [admin] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, data.user.email.toLowerCase()))
    .limit(1);
  if (!admin) return null;

  return { authUserId: data.user.id, email: data.user.email, admin };
}

/** Back-compat: existing callers using getAdminUser() get the auth user object only. */
export async function getAdminUser() {
  const session = await getAdminSession();
  return session
    ? {
        id: session.authUserId,
        email: session.email,
        role: session.admin.role,
      }
    : null;
}

export type RequireAdminApiResult =
  | { user: null; unauthorized: NextResponse; session: null }
  | { user: { id: string; email: string }; unauthorized: null; session: AdminSession };

/**
 * For API routes — returns 401 NextResponse if not allow-listed, otherwise
 * the resolved AdminSession. Pattern:
 *
 *   const auth = await requireAdminApi();
 *   if (!auth.user) return auth.unauthorized;
 *   // auth.session.admin.role === "superadmin" | "admin"
 */
export async function requireAdminApi(): Promise<RequireAdminApiResult> {
  const session = await getAdminSession();
  if (!session) {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      ),
    };
  }
  return {
    user: { id: session.authUserId, email: session.email },
    session,
    unauthorized: null,
  };
}

/** For superadmin-only API routes (manage admin_users). */
export async function requireSuperAdminApi(): Promise<RequireAdminApiResult> {
  const result = await requireAdminApi();
  if (!result.user) return result;
  if (result.session.admin.role !== "superadmin") {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        { error: "forbidden", message: "superadmin only" },
        { status: 403 },
      ),
    };
  }
  return result;
}
