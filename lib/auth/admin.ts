/**
 * Admin auth + role-tier helpers — Server Components + API routes.
 *
 * Two-layer auth:
 *   1. Supabase magic-link verifies the email (via /admin/auth-callback).
 *   2. The email must also exist in the `admin_users` allowlist table.
 *
 * Role tiers (high → low privilege on user management):
 *   superadmin > admin > editor > assessor
 *
 * Permission helpers map roles to capabilities. Use these instead of
 * comparing role strings ad-hoc.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { adminUsers, type AdminUser } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AdminRole = AdminUser["role"];

/* ---------- Role tier ordering ---------- */

const ROLE_RANK: Record<AdminRole, number> = {
  superadmin: 4,
  admin: 3,
  editor: 2,
  assessor: 1,
};

/** Returns true if `role` is at or above the rank of `min`. */
export function hasRoleAtLeast(role: AdminRole, min: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/* ---------- Capability matrix ---------- */

/**
 * Capabilities, keyed by feature. Centralised so the UI and server share
 * the same truth.
 */
export const CAN = {
  // Read everywhere; everyone in the allowlist sees the dashboard.
  viewDashboard: (r: AdminRole) => hasRoleAtLeast(r, "assessor"),
  viewResponses: (r: AdminRole) => hasRoleAtLeast(r, "assessor"),
  scoreOpenEnded: (r: AdminRole) => hasRoleAtLeast(r, "assessor"),
  // Editor-and-up: authoring + exports + archive.
  editAssessments: (r: AdminRole) => hasRoleAtLeast(r, "editor"),
  exportResponses: (r: AdminRole) => hasRoleAtLeast(r, "editor"),
  archiveAudio: (r: AdminRole) => hasRoleAtLeast(r, "editor"),
  // Editor + admin (and super) can delete responses; assessor cannot.
  deleteResponses: (r: AdminRole) => hasRoleAtLeast(r, "editor"),
  // Admin-and-up: invite editor/assessor users.
  inviteEditorOrAssessor: (r: AdminRole) => hasRoleAtLeast(r, "admin"),
  removeEditorOrAssessor: (r: AdminRole) => hasRoleAtLeast(r, "admin"),
  // Super-only: invite/remove other admins or supers.
  inviteAdminOrSuper: (r: AdminRole) => hasRoleAtLeast(r, "superadmin"),
  removeAdminOrSuper: (r: AdminRole) => hasRoleAtLeast(r, "superadmin"),
  // Visibility — only super sees the Users nav item.
  viewUsersPage: (r: AdminRole) => hasRoleAtLeast(r, "admin"),
} as const;

/** Roles an inviter is allowed to grant when adding a new admin_user. */
export function rolesGrantableBy(inviter: AdminRole): AdminRole[] {
  if (inviter === "superadmin") {
    return ["superadmin", "admin", "editor", "assessor"];
  }
  if (inviter === "admin") return ["editor", "assessor"];
  return [];
}

/* ---------- Session lookup ---------- */

export type AdminSession = {
  authUserId: string;
  email: string;
  admin: AdminUser;
};

/** Joined Supabase user + admin_users row, or null if either is missing. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;

  const [admin] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, data.user.email.toLowerCase()))
    .limit(1);
  if (!admin) return null;

  return { authUserId: data.user.id, email: data.user.email, admin };
}

/** Convenience: just the user shape (with role) — for back-compat. */
export async function getAdminUser() {
  const session = await getAdminSession();
  return session
    ? {
        id: session.authUserId,
        email: session.email,
        role: session.admin.role,
      }
    : null;
}

/* ---------- API gate helpers ---------- */

export type RequireAdminApiResult =
  | { user: null; unauthorized: NextResponse; session: null }
  | {
      user: { id: string; email: string };
      unauthorized: null;
      session: AdminSession;
    };

/** Any allow-listed user. Use as a baseline check. */
export async function requireAdminApi(): Promise<RequireAdminApiResult> {
  const session = await getAdminSession();
  if (!session) {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      ),
    };
  }
  return {
    user: { id: session.authUserId, email: session.email },
    session,
    unauthorized: null,
  };
}

/**
 * Generic role-tier gate. Pattern:
 *
 *   const auth = await requireRoleApi("editor");
 *   if (!auth.user) return auth.unauthorized;
 *   // auth.session.admin.role is editor | admin | superadmin
 */
export async function requireRoleApi(
  min: AdminRole,
): Promise<RequireAdminApiResult> {
  const result = await requireAdminApi();
  if (!result.user) return result;
  if (!hasRoleAtLeast(result.session.admin.role, min)) {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        { error: "forbidden", message: `${min}-or-above only` },
        { status: 403 },
      ),
    };
  }
  return result;
}

/* ---------- Convenience wrappers ---------- */

export const requireSuperAdminApi = () => requireRoleApi("superadmin");
export const requireAdminTierApi = () => requireRoleApi("admin");
export const requireEditorApi = () => requireRoleApi("editor");

/**
 * Talent Validation Engine — requires `can_approve_skillboards`
 * (Learning Expert) on top of editor+ tier. PRD §1b.
 *
 * Used by: cell approve/reject/bulk-approve, skillboard activate.
 * NOT used by cell edit-in-place (any editor can edit; permission
 * gate is only for cells that *go live*).
 */
export async function requireSkillboardApproverApi(): Promise<RequireAdminApiResult> {
  const result = await requireRoleApi("editor");
  if (!result.user) return result;
  if (!result.session.admin.canApproveSkillboards) {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        {
          error: "forbidden",
          message:
            "Learning Expert only — your admin user needs can_approve_skillboards.",
        },
        { status: 403 },
      ),
    };
  }
  return result;
}

/**
 * Skillboard access gate — checks the `skillboard_access` feature
 * flag (role-based; superadmin manages in /admin/settings). Used by
 * VIEW/CREATE/EDIT skillboard routes (anything that's not the
 * approve/activate gate, which uses requireSkillboardApproverApi).
 *
 * Superadmin always has access regardless of flag.
 */
export async function requireSkillboardAccessApi(): Promise<RequireAdminApiResult> {
  const result = await requireAdminApi();
  if (!result.user) return result;

  // Superadmin bypass (so a misconfigured flag can't lock everyone out).
  if (result.session.admin.role === "superadmin") return result;

  const { loadSkillboardAccessRoles, canAccessSkillboards } = await import(
    "@/lib/auth/feature-flags"
  );
  const allowed = await loadSkillboardAccessRoles();
  if (!canAccessSkillboards(result.session.admin.role, allowed)) {
    return {
      user: null,
      session: null,
      unauthorized: NextResponse.json(
        {
          error: "forbidden",
          message:
            "Skillboard access is restricted to roles configured under Settings → Skillboard access.",
        },
        { status: 403 },
      ),
    };
  }
  return result;
}
