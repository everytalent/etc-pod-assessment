/**
 * Root proxy (Next 16's renamed `middleware`) — gates /admin (page) and
 * /api/admin (API) on a Supabase session, while keeping /admin/login and
 * /admin/auth-callback open so the sign-in flow can complete.
 */

import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_ADMIN_PATHS = new Set<string>([
  "/admin/login",
  "/admin/auth-callback",
]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const { response, userId } = await updateSession(request);

  const isAdminApi = path.startsWith("/api/admin");
  const isAdminPage = path.startsWith("/admin");
  const isPublicAdmin =
    PUBLIC_ADMIN_PATHS.has(path) || path.startsWith("/admin/auth-callback");

  if (!userId) {
    if (isAdminApi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (isAdminPage && !isPublicAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
