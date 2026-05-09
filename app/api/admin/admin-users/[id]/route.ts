/**
 * DELETE /api/admin/admin-users/[id] — remove a user from the allowlist.
 *
 * Permissions:
 *   admin      → can remove editor + assessor only.
 *   superadmin → can remove any user.
 *
 * Safety rails (apply to all callers):
 *   1. Cannot delete yourself (would lock yourself out).
 *   2. Cannot remove the last superadmin.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import {
  hasRoleAtLeast,
  requireAdminTierApi,
} from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminTierApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  if (id === auth.session.admin.id) {
    return NextResponse.json(
      { error: "cannot_delete_self" },
      { status: 400 },
    );
  }

  const [target] = await db
    .select({ id: adminUsers.id, role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Tier check: only superadmin can remove admin or superadmin users.
  // Admin tier can remove editor + assessor only.
  const targetIsAdminTier = hasRoleAtLeast(target.role, "admin");
  if (
    targetIsAdminTier &&
    !hasRoleAtLeast(auth.session.admin.role, "superadmin")
  ) {
    return NextResponse.json(
      {
        error: "insufficient_role",
        message: "Only a superadmin can remove an admin or superadmin.",
      },
      { status: 403 },
    );
  }

  // If removing the last superadmin, block it regardless of who's calling.
  if (target.role === "superadmin") {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(adminUsers)
      .where(and(eq(adminUsers.role, "superadmin"), ne(adminUsers.id, id)));
    if (count === 0) {
      return NextResponse.json(
        {
          error: "would_orphan_admins",
          message: "Cannot remove the last superadmin.",
        },
        { status: 400 },
      );
    }
  }

  await db.delete(adminUsers).where(eq(adminUsers.id, id));
  return NextResponse.json({ deleted: id });
}
