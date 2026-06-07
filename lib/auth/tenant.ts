/**
 * Tenant auth + role-tier helpers — Server Components + API routes.
 *
 * Mirrors lib/auth/admin.ts for the tenant-facing surface (PRD
 * 2026-06-02-tenant-assessment-builder.md, Phase 0).
 *
 * Two-layer auth:
 *   1. Supabase magic-link verifies the email (via /tenant/auth-callback).
 *   2. The email must also exist in the `tenant_users` allowlist table,
 *      scoped to exactly one tenant via tenantId.
 *
 * Role tiers (high → low):
 *   owner > admin > member
 *
 * An admin user (lib/auth/admin.ts) and a tenant user are mutually
 * exclusive identities — a single email row lives in exactly one of
 * admin_users or tenant_users. We do not attempt to cross-grant; ETC
 * staff who need to act inside a tenant account use the tenant's
 * normal invite flow.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { tenantUsers, tenants, type TenantUser, type Tenant } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TenantRole = TenantUser["role"];

const ROLE_RANK: Record<TenantRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export function hasTenantRoleAtLeast(
  role: TenantRole,
  min: TenantRole,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Capabilities the tenant-facing surface gates on. */
export const TENANT_CAN = {
  viewDashboard: (r: TenantRole) => hasTenantRoleAtLeast(r, "member"),
  createAssessment: (r: TenantRole) => hasTenantRoleAtLeast(r, "member"),
  viewCandidateResults: (r: TenantRole) => hasTenantRoleAtLeast(r, "member"),
  overrideScore: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  triggerReassessment: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  manageBranding: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  manageBilling: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  purchaseCredits: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  inviteUsers: (r: TenantRole) => hasTenantRoleAtLeast(r, "admin"),
  removeUsers: (r: TenantRole) => hasTenantRoleAtLeast(r, "owner"),
  deleteTenant: (r: TenantRole) => hasTenantRoleAtLeast(r, "owner"),
} as const;

export type TenantSession = {
  authUserId: string;
  email: string;
  tenantUser: TenantUser;
  tenant: Tenant;
};

/** Joined Supabase user + tenant_users row + tenants row, or null. */
export async function getTenantSession(): Promise<TenantSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;

  const [row] = await db
    .select({ tenantUser: tenantUsers, tenant: tenants })
    .from(tenantUsers)
    .innerJoin(tenants, eq(tenants.id, tenantUsers.tenantId))
    .where(eq(tenantUsers.email, data.user.email.toLowerCase()))
    .limit(1);
  if (!row) return null;

  return {
    authUserId: data.user.id,
    email: data.user.email,
    tenantUser: row.tenantUser,
    tenant: row.tenant,
  };
}

export type RequireTenantApiResult =
  | { user: null; unauthorized: NextResponse; session: null }
  | {
      user: { id: string; email: string };
      unauthorized: null;
      session: TenantSession;
    };

export async function requireTenantApi(): Promise<RequireTenantApiResult> {
  const session = await getTenantSession();
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

export async function requireTenantRoleApi(
  min: TenantRole,
): Promise<RequireTenantApiResult> {
  const result = await requireTenantApi();
  if (!result.user) return result;
  if (!hasTenantRoleAtLeast(result.session.tenantUser.role, min)) {
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

export const requireTenantOwnerApi = () => requireTenantRoleApi("owner");
export const requireTenantAdminApi = () => requireTenantRoleApi("admin");
export const requireTenantMemberApi = () => requireTenantRoleApi("member");
