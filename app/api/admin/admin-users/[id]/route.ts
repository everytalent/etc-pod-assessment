/**
 * /api/admin/admin-users/[id]
 *
 *   PATCH  — flip per-user toggles (currently: can_approve_skillboards,
 *            i.e. the "Learning Expert" flag that lets a user approve /
 *            reject / edit / regenerate cells on a skillboard).
 *
 *   DELETE — remove a user from the allowlist.
 *
 * Permissions:
 *   admin tier+ can flip Learning Expert on/off for editor + assessor.
 *   superadmin can flip it for anyone except themselves.
 *
 * Safety rails on DELETE:
 *   1. Cannot delete yourself (would lock yourself out).
 *   2. Cannot remove the last superadmin.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  hasRoleAtLeast,
  requireAdminTierApi,
} from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

const patchSchema = z.object({
  can_approve_skillboards: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminTierApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = patchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [target] = await db
    .select({ id: adminUsers.id, role: adminUsers.role })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Tier rule: admin can flip toggles on editor + assessor only.
  // Superadmin can flip toggles on anyone except themselves.
  const targetIsAdminTier = hasRoleAtLeast(target.role, "admin");
  if (
    targetIsAdminTier &&
    !hasRoleAtLeast(auth.session.admin.role, "superadmin")
  ) {
    return NextResponse.json(
      {
        error: "insufficient_role",
        message: "Only a superadmin can change toggles on an admin tier user.",
      },
      { status: 403 },
    );
  }
  if (
    id === auth.session.admin.id &&
    input.can_approve_skillboards === false
  ) {
    return NextResponse.json(
      {
        error: "cannot_demote_self",
        message:
          "Don't switch Learning Expert off on your own account — you'd lose approve-cell access mid-flow.",
      },
      { status: 400 },
    );
  }

  const updates: { canApproveSkillboards?: boolean } = {};
  if (input.can_approve_skillboards !== undefined) {
    updates.canApproveSkillboards = input.can_approve_skillboards;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ updated: false, reason: "no_changes" });
  }

  await db.update(adminUsers).set(updates).where(eq(adminUsers.id, id));
  return NextResponse.json({ updated: true });
}

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
