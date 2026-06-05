/**
 * POST /api/admin/skillboards/[id]/archive   { archive: true | false }
 *
 * Soft-delete (or restore) a skillboard. Sets archived_at to now /
 * null. Does not touch the underlying skills/tasks/cells/responses —
 * those stay so historical profiles can resolve their structure.
 *
 * Effects of archive=true:
 *   - Skillboard hidden from /admin/skillboards default listing
 *   - POST /api/internal/sessions returns 422 unknown_specialisation
 *   - The Validation Bank sentinel assessment stays active for
 *     in-progress responses (we don't touch it)
 *
 * Permission: superadmin only.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { skillboards } from "@/lib/db/schema";

const inputSchema = z.object({
  archive: z.boolean(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

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

  const [updated] = await db
    .update(skillboards)
    .set({
      archivedAt: input.archive ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(skillboards.id, id))
    .returning({ id: skillboards.id, archivedAt: skillboards.archivedAt });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    archived: updated.archivedAt !== null,
  });
}
