/**
 * /admin/users — allowlist management. Visible to admin + superadmin.
 *
 * Editor + assessor get 404 — the route doesn't hint at its existence.
 *
 * Admin can invite editor + assessor and remove the same.
 * Superadmin can invite/remove any role (incl. other superadmins).
 */

import { desc } from "drizzle-orm";
import { notFound } from "next/navigation";

import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { CAN, getAdminSession } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getAdminSession();
  if (!session || !CAN.viewUsersPage(session.admin.role)) {
    notFound();
  }

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(desc(adminUsers.createdAt));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Allowlist
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Admin users</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Anyone in this list can sign in via magic link; anyone outside is
        rejected at the auth callback. Removing yourself is blocked; removing
        the last superadmin is blocked.
      </p>
      <div className="mt-8">
        <AdminUsersTable
          rows={rows}
          currentAdminId={session.admin.id}
          currentAdminRole={session.admin.role}
        />
      </div>
    </main>
  );
}
