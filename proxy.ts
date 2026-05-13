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
  // Admin preview lets a logged-in admin walk the candidate flow on the
  // admin host. We mark it with a short-lived `etc_preview` cookie set by
  // the intake page; while present, candidate paths + candidate APIs are
  // allowed on the admin host. Without that cookie (or an explicit
  // ?preview=true on the URL), all non-admin paths on admin host 404.
  const inPreviewMode =
    request.nextUrl.searchParams.get("preview") === "true" ||
    request.cookies.get("etc_preview")?.value === "1";

  if (onAdminHost && !adminPath) {
    // Bare root on admin host → bounce to /admin (which then runs auth gate).
    if (path === "/" || path === "") {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
    // Allow candidate page + API paths during preview.
    const isPreviewablePath =
      path.startsWith("/assess/") || path.startsWith("/api/");
    if (!(inPreviewMode && isPreviewablePath)) {
      return new NextResponse("Not found", { status: 404 });
    }
  }
  if (onCandidateHost && adminPath) {
    // Redirect rather than 404. Admin chrome lives on the admin host; bare
    // 404 stranded anyone who landed here via a bookmark, typo, or an old
    // magic link that pre-dated the host pin (commit 9704906). Preserves
    // path + query so error params (?error=Email+link+is+invalid…) and
    // ?next= still render correctly on /admin/login. API paths get the
    // same redirect — callers handling /api/admin/* across hosts will see
    // a 308 and can either follow or surface the host mismatch.
    const target = new URL(request.nextUrl.toString());
    target.host = "admin.energytalentco.com";
    target.protocol = "https:";
    target.port = "";
    return NextResponse.redirect(target, 308);
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
