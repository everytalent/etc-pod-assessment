/**
 * Admin layout — chrome (header + nav + sign-out) for gated routes.
 *
 * Middleware redirects unauthenticated users to /admin/login. This layout
 * also wraps /login and /auth-callback; for those (no session), we render
 * bare-bones with no chrome.
 *
 * Nav items render based on role tier (CAN.* helpers):
 *   - Assessments link: everyone in the allowlist
 *   - Users link: admin + superadmin
 */

import Link from "next/link";

import { AdminSignOutButton } from "@/components/admin/AdminSignOutButton";
import { CAN, getAdminSession } from "@/lib/auth/admin";
import type { AdminUser } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROLE_BADGE: Record<AdminUser["role"], string> = {
  superadmin: "border-etc-marigold bg-etc-marigold/15 text-etc-black",
  admin: "border-etc-marigold/60 bg-etc-marigold/5 text-foreground",
  editor: "border-border bg-muted text-foreground",
  assessor: "border-border bg-muted text-muted-foreground",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAdminSession();
  if (!session) {
    return <>{children}</>;
  }

  const role = session.admin.role;

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
              <Link
                href="/admin/skillboards"
                className="text-muted-foreground hover:text-foreground"
              >
                Skillboards
              </Link>
              <Link
                href="/admin/candidate-profiles"
                className="text-muted-foreground hover:text-foreground"
              >
                Profiles
              </Link>
              <Link
                href="/admin/question-bank-proposals"
                className="text-muted-foreground hover:text-foreground"
              >
                Proposals
              </Link>
              {(role === "admin" || role === "superadmin") && (
                <Link
                  href="/admin/shadow-review"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Shadow review
                </Link>
              )}
              {role === "superadmin" && (
                <Link
                  href="/admin/ai-spend"
                  className="text-muted-foreground hover:text-foreground"
                >
                  AI spend
                </Link>
              )}
              {CAN.viewUsersPage(role) && (
                <Link
                  href="/admin/users"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Users
                </Link>
              )}
              {role === "superadmin" && (
                <Link
                  href="/admin/settings"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Settings
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 text-xs text-muted-foreground sm:inline-flex">
              {session.email}
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider",
                  ROLE_BADGE[role],
                )}
              >
                {role}
              </span>
            </span>
            <AdminSignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
