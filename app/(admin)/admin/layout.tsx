/**
 * Admin layout — chrome (header + nav + sign-out) for gated routes.
 *
 * Middleware redirects unauthenticated users to /admin/login. This layout
 * also wraps /login and /auth-callback; for those (no session), we render
 * bare-bones with no chrome.
 *
 * "Users" nav link is visible only to superadmin role.
 */

import Link from "next/link";

import { AdminSignOutButton } from "@/components/admin/AdminSignOutButton";
import { getAdminSession } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    return <>{children}</>;
  }

  const isSuperadmin = session.admin.role === "superadmin";

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <Link
              href="/admin"
              className="flex items-center gap-2 text-sm font-bold tracking-tight"
            >
              <span className="rounded-md bg-etc-marigold px-2 py-0.5 text-[0.65rem] font-bold text-etc-black">
                ETC
              </span>
              <span>Admin</span>
            </Link>
            <nav className="flex items-center gap-4 text-xs font-medium">
              <Link
                href="/admin"
                className="text-muted-foreground hover:text-foreground"
              >
                Assessments
              </Link>
              {isSuperadmin && (
                <Link
                  href="/admin/users"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Users
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {session.email}
              {isSuperadmin && (
                <span className="ml-2 rounded-full border border-etc-marigold bg-etc-marigold/15 px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-etc-black">
                  superadmin
                </span>
              )}
            </span>
            <AdminSignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
