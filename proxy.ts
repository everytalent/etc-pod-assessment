/**
 * Root proxy (Next 16's renamed middleware) — two responsibilities:
 *
 *   1. HOST GATING. The deploy serves both surfaces, but each subdomain only
 *      renders one of them. On admin.energytalentco.com, candidate paths are
 *      404'd; on assess.energytalentco.com, admin paths are 404'd. This
 *      gives real cookie + cross-site isolation between the two audiences.
 *
 *   2. AUTH GATING for /admin. Refreshes the Supabase session and redirects
 *      unauthenticated requests to /admin/login. Defence-in-depth on top of
 *      the per-route requireAdminApi() check.
 *
 * Hosts that are neither admin nor candidate (e.g. the .netlify.app URL,
 * localhost during dev) get full access — useful for fallback access while
 * DNS is propagating.
 */

import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_ADMIN_PATHS = new Set<string>([
  "/admin/login",
  "/admin/auth-callback",
]);

const ADMIN_HOSTS = new Set<string>([
  "admin.energytalentco.com",
]);
const CANDIDATE_HOSTS = new Set<string>([
  "assess.energytalentco.com",
]);

function isAdminPath(path: string): boolean {
  return path.startsWith("/admin") || path.startsWith("/api/admin");
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const onAdminHost = ADMIN_HOSTS.has(host);
  const onCandidateHost = CANDIDATE_HOSTS.has(host);
  const adminPath = isAdminPath(path);

  // ---- Host gating ----
  if (onAdminHost && !adminPath) {
    // Bare root on admin host → bounce to /admin (which then runs auth gate).
    if (path === "/" || path === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
    // Admin Preview button opens /assess/<slug>?preview=true on the admin
    // host so the admin's auth cookie travels and the preview check passes.
    // Allow that one combo through; everything else /assess/* on admin
    // host is rejected.
    const isPreview =
      path.startsWith("/assess/") &&
      request.nextUrl.searchParams.get("preview") === "true";
    if (!isPreview) {
      return new NextResponse("Not found", { status: 404 });
    }
  }
  if (onCandidateHost && adminPath) {
    return new NextResponse("Not found", { status: 404 });
  }

  // ---- Auth gating for admin surface ----
  if (!adminPath) {
    return NextResponse.next({ request });
  }

  const { response, userId } = await updateSession(request);
  const isPublicAdmin =
    PUBLIC_ADMIN_PATHS.has(path) || path.startsWith("/admin/auth-callback");

  if (!userId) {
    if (path.startsWith("/api/admin")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!isPublicAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Match everything except Next.js internals + static assets — we need the
  // proxy on candidate paths too, so it can 404 them on the admin host.
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
