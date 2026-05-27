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

import { requireEditorApi } from "@/lib/auth/admin";
import {
  getSkillboardDetail,
  patchSkillboard,
} from "@/lib/engines/assessment/skillboards/repository";
import { patchSkillboardInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireEditorApi();
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
  const auth = await requireEditorApi();
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
    description: input.description,
    mindsets: input.mindsets,
    behaviouralSkills: input.behavioural_skills,
    parentSkillboardId: input.parent_skillboard_id ?? null,
  });

  return NextResponse.json({ ok: true });
}
