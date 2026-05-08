/**
 * Admin layout — chrome (header + sign-out) for the gated routes.
 *
 * Middleware already redirects unauthenticated users to /admin/login. This
 * layout still wraps /login and /auth-callback, so we render bare-bones
 * (no header) when there's no user yet.
 */

import Link from "next/link";

import { AdminSignOutButton } from "@/components/admin/AdminSignOutButton";
import { getAdminUser } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAdminUser();
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            href="/admin"
            className="flex items-center gap-2 text-sm font-bold tracking-tight"
          >
            <span className="rounded-md bg-etc-marigold px-2 py-0.5 text-[0.65rem] font-bold text-etc-black">
              ETC
            </span>
            <span>Admin</span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {user.email}
            </span>
            <AdminSignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
