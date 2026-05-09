/**
 * DELETE /api/admin/admin-users/[id] — revoke an admin (superadmin only).
 *
 * Two safety rails:
 *   1. Cannot delete yourself (would lock yourself out).
 *   2. Cannot delete the last superadmin.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  if (id === auth.session.admin.id) {
    return NextResponse.json(
      { error: "cannot_delete_self" },
      { status: 400 },
    );
  }

  // Look up the row first so we know its role.
  const [target] = await db
    .select({ id: adminUsers.id, role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // If deleting a superadmin, ensure at least one other superadmin remains.
  if (target.role === "superadmin") {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, "superadmin"), ne(adminUsers.id, id)));
    if (count === 0) {
      return NextResponse.json(
        { error: "would_orphan_admins", message: "Cannot remove the last superadmin." },
        { status: 400 },
      );
    }
  }

  await db.delete(adminUsers).where(eq(adminUsers.id, id));
  return NextResponse.json({ deleted: id });
}
