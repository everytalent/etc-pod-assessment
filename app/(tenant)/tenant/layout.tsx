/**
 * Tenant layout — chrome for the tenant-facing surface.
 *
 * The bare layout wraps /tenant/login and /tenant/auth-callback (sessions
 * may not exist there yet). Authenticated pages get a tenant nav,
 * workspace badge, and sign-out.
 *
 * Brand theming arrives in Phase 1 — for now the layout uses ETC default
 * colours.
 */

import Link from "next/link";

import { getTenantSession } from "@/lib/auth/tenant";

export const dynamic = "force-dynamic";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getTenantSession();
  if (!session) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/tenant"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              {session.tenant.name}
            </Link>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              {session.tenantUser.role}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{session.email}</span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl items-center gap-5 px-6 py-2 text-[0.78rem] font-medium text-muted-foreground">
          <Link href="/tenant" className="hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/tenant/assessments" className="hover:text-foreground">
            Assessments
          </Link>
          <Link href="/tenant/candidates" className="hover:text-foreground">
            Candidates
          </Link>
          <Link href="/tenant/settings" className="ml-auto hover:text-foreground">
            Settings
          </Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
