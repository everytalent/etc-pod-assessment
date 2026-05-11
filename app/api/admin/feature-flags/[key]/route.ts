/**
 * GET   /api/admin/feature-flags/[key] — read a flag
 * PATCH /api/admin/feature-flags/[key] — update enabled_for_roles
 *
 * Superadmin only — these change who can see / run AI scoring across
 * the whole tenant.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { featureFlags } from "@/lib/db/schema";

const VALID_ROLES = ["superadmin", "admin", "editor", "assessor"] as const;

const patchSchema = z.object({
  enabled_for_roles: z.array(z.enum(VALID_ROLES)).max(VALID_ROLES.length),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { key } = await params;
  const [row] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ flag: row });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { key } = await params;

  let input;
  try {
    input = patchSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Upsert so a missing row is created on first save.
  const [updated] = await db
    .insert(featureFlags)
    .values({
      key,
      enabledForRoles: input.enabled_for_roles,
      updatedBy: auth.session.admin.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: featureFlags.key,
      set: {
        enabledForRoles: input.enabled_for_roles,
        updatedBy: auth.session.admin.id,
        updatedAt: new Date(),
      },
    })
    .returning();

  return NextResponse.json({ flag: updated });
}
