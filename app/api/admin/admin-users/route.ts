/**
 * GET  /api/admin/admin-users — list allow-listed admins (superadmin only).
 * POST /api/admin/admin-users — invite a new admin (superadmin only).
 *
 * "Invite" here just adds a row to admin_users. The invitee then signs in
 * via the normal magic-link flow; the auth-callback's allowlist check now
 * passes for them.
 */

import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(["superadmin", "admin"]).default("admin"),
});

export async function GET() {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(desc(adminUsers.createdAt));
  return NextResponse.json({ admins: rows });
}

export async function POST(req: Request) {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inviteSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const [created] = await db
      .insert(adminUsers)
      .values({
        email: input.email,
        role: input.role,
        invitedBy: auth.session.admin.id,
      })
      .returning();
    return NextResponse.json({ admin: created }, { status: 201 });
  } catch (err) {
    // Unique constraint violation on email.
    if (err instanceof Error && err.message.toLowerCase().includes("unique")) {
      return NextResponse.json(
        { error: "already_invited" },
        { status: 409 },
      );
    }
    throw err;
  }
}
