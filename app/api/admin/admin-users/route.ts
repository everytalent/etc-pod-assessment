/**
 * GET  /api/admin/admin-users — list allow-listed users.
 * POST /api/admin/admin-users — invite a user.
 *
 * Permissions (PRD §10 roles):
 *   GET  : admin tier and up (admin, superadmin) — assessor/editor never see this page.
 *   POST : admin can grant editor/assessor; superadmin can grant any role.
 *
 * "Invite" just adds a row to admin_users. The invitee then signs in via
 * magic link and the auth-callback's allowlist check passes for them.
 */

import { desc } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireAdminTierApi,
  rolesGrantableBy,
} from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { adminUsers } from "@/lib/db/schema";
import { getSupabaseAdmin } from "@/lib/supabase/storage-admin";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  role: z.enum(["superadmin", "admin", "editor", "assessor"]),
});

export async function GET() {
  const auth = await requireAdminTierApi();
  if (!auth.user) return auth.unauthorized;

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(desc(adminUsers.createdAt));
  return NextResponse.json({ admins: rows });
}

export async function POST(req: Request) {
  const auth = await requireAdminTierApi();
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

  // Inviter can only grant roles their tier permits.
  const grantable = rolesGrantableBy(auth.session.admin.role);
  if (!grantable.includes(input.role)) {
    return NextResponse.json(
      {
        error: "role_not_grantable",
        message: `${auth.session.admin.role} cannot grant ${input.role} role.`,
        allowed: grantable,
      },
      { status: 403 },
    );
  }

  let created;
  try {
    [created] = await db
      .insert(adminUsers)
      .values({
        email: input.email,
        role: input.role,
        invitedBy: auth.session.admin.id,
      })
      .returning();
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes("unique")) {
      return NextResponse.json({ error: "already_invited" }, { status: 409 });
    }
    throw err;
  }

  // Send the invitation email via Supabase Auth's invite flow. The link in
  // the email lands at /admin/auth-callback on whatever host requested
  // this invite — derived from the incoming Origin/Host so it works on
  // both the netlify.app fallback and admin.energytalentco.com.
  let inviteEmailSent = false;
  let inviteEmailError: string | null = null;
  try {
    const headerStore = await headers();
    const origin =
      headerStore.get("origin") ??
      (headerStore.get("host")
        ? `https://${headerStore.get("host")}`
        : "https://admin.energytalentco.com");
    const supa = getSupabaseAdmin();
    const { error } = await supa.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${origin}/admin/auth-callback?next=/admin`,
      data: {
        invited_role: input.role,
        invited_by_email: auth.session.email,
      },
    });
    if (error) {
      // Most common: user already exists in auth.users (e.g. someone who
      // signed up before). Treat as soft-success — they can sign in via
      // the regular magic-link flow now that they're allow-listed.
      inviteEmailError = error.message;
    } else {
      inviteEmailSent = true;
    }
  } catch (err) {
    inviteEmailError = err instanceof Error ? err.message : "unknown";
  }

  return NextResponse.json(
    {
      admin: created,
      invite_email_sent: inviteEmailSent,
      invite_email_error: inviteEmailError,
    },
    { status: 201 },
  );
}
