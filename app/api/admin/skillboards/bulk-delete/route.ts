/**
 * POST /api/admin/skillboards/bulk-delete
 *
 * Body: { skillboard_ids: string[], force?: boolean }
 *
 * Removes a batch of skillboards. Skills, tasks, level expectations,
 * authoring jobs, and provisional-framework rows cascade via FKs.
 *
 * Safety default: refuses to delete an ACTIVE skillboard (activated_at
 * is set) unless `force: true` is passed. Activated boards may have
 * live candidate sessions referencing their questions; deleting them
 * silently corrupts in-flight assessments.
 *
 * Permission: superadmin only. Skillboards are foundational data and
 * a bad bulk-delete is easy to fire and hard to undo.
 */

import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { skillboards } from "@/lib/db/schema";

const inputSchema = z.object({
  skillboard_ids: z.array(z.string().uuid()).min(1).max(100),
  force: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (!input.force) {
    const rows = await db
      .select({
        id: skillboards.id,
        specialisation: skillboards.specialisation,
        activatedAt: skillboards.activatedAt,
      })
      .from(skillboards)
      .where(inArray(skillboards.id, input.skillboard_ids));
    const active = rows.filter((s) => s.activatedAt !== null);
    if (active.length > 0) {
      return NextResponse.json(
        {
          error: "cannot_delete_active_without_force",
          message:
            "Some of these skillboards are activated. Retry with force:true if you're sure — this may break in-flight candidate assessments.",
          active_skillboards: active.map((s) => ({
            id: s.id,
            specialisation: s.specialisation,
          })),
        },
        { status: 409 },
      );
    }
  }

  const removed = await db
    .delete(skillboards)
    .where(inArray(skillboards.id, input.skillboard_ids))
    .returning({ id: skillboards.id });

  return NextResponse.json({
    deleted_count: removed.length,
    deleted_ids: removed.map((r) => r.id),
    forced: input.force,
  });
}
