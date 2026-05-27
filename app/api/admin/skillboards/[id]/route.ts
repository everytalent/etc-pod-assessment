/**
 * /api/admin/skillboards/[id]
 *
 *   GET   — full board detail (skills, tasks, cells, mindsets, counts)
 *   PATCH — edit board-level fields (description, mindsets, behavioural skills,
 *           parent_skillboard_id). Cell edits go via /level-expectations.
 *
 * GET is editor+. PATCH is editor+ (board-level fields don't gate on
 * Learning Expert).
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  requireSkillboardAccessApi,
  requireSuperAdminApi,
} from "@/lib/auth/admin";
import {
  deleteSkillboard,
  getSkillboardDetail,
  patchSkillboard,
} from "@/lib/engines/assessment/skillboards/repository";
import { patchSkillboardInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const detail = await getSkillboardDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  let input;
  try {
    input = patchSkillboardInputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Verify the board exists before patching — returns a clean 404.
  const detail = await getSkillboardDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await patchSkillboard(id, {
    specialisation: input.specialisation,
    description: input.description,
    mindsets: input.mindsets,
    behaviouralSkills: input.behavioural_skills,
    parentSkillboardId: input.parent_skillboard_id ?? null,
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/skillboards/[id]
 *
 * Hard-deletes a skillboard and everything it owns (skills, tasks,
 * level_expectations, authoring jobs — all via ON DELETE CASCADE).
 * question_bank_proposals stay as orphaned rows (their FK to tasks is
 * set null on delete, intentional).
 *
 * Permission: SUPERADMIN ONLY. This is destructive and irreversible —
 * no soft-delete, no restore. Editors with skillboard_access can edit
 * and rename, but cannot delete.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const ok = await deleteSkillboard(id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
