/**
 * PATCH /api/admin/tasks/[id]
 *
 * Rename a task on a skillboard. Doesn't touch the 15 cells under it
 * (cell text was authored against the previous task name as context;
 * downstream regenerations after rename will use the new name).
 *
 * Permission: editor+ (renaming is content, not approval).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSkillboardAccessApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";

const inputSchema = z.object({
  name: z.string().trim().min(5).max(160),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
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
    .update(tasks)
    .set({ name: input.name })
    .where(eq(tasks.id, id))
    .returning({ id: tasks.id, name: tasks.name });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ updated: true, name: updated.name });
}
