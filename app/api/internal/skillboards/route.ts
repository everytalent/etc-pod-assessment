/**
 * POST /api/internal/skillboards
 *
 * Cross-engine contract: lets another ETC engine (today, the Training
 * Engine's course-creation wizard) commission a skillboard without an
 * admin browser session. Same flow as the admin route
 * (app/api/admin/skillboards/route.ts) — vet the brief, insert the row,
 * enqueue the async structure-authoring job — but gated on a service
 * token instead of `requireSkillboardAccessApi()`.
 *
 * Deliberately Claude-authored path only. The upload path is admin-UI
 * territory (a human picking a spreadsheet); an engine calling this has
 * a brief, not a file.
 *
 * Auth: Bearer service token (ETC_ASSESSMENT_SERVICE_TOKEN).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { vetBrief } from "@/lib/engines/assessment/skillboards/brief-validator";
import {
  createSkillboard,
  getSkillboardBySpecialisation,
} from "@/lib/engines/assessment/skillboards/repository";
import { createSkillboardClaudeInputSchema } from "@/lib/engines/assessment/skillboards/types";

export async function POST(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let input;
  try {
    input = createSkillboardClaudeInputSchema.parse({
      ...(await req.json()),
      creation_path: "claude_authored",
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Specialisation is unique. An orphan (row created but structure
  // authoring never populated it) is safe to replace; a populated board
  // is not — the caller should reuse it rather than duplicate.
  const existing = await getSkillboardBySpecialisation(input.specialisation);
  if (existing) {
    const { db } = await import("@/lib/db/client");
    const { skills, skillboards } = await import("@/lib/db/schema");
    const skillRows = await db
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.skillboardId, existing.id))
      .limit(1);
    const isOrphan = skillRows.length === 0 && !existing.activatedAt;
    if (!isOrphan) {
      return NextResponse.json(
        {
          error: "specialisation_exists",
          message: `A skillboard for "${input.specialisation}" already exists.`,
          existing_id: existing.id,
        },
        { status: 409 },
      );
    }
    await db.delete(skillboards).where(eq(skillboards.id, existing.id));
  }

  // Fail-open, same as the admin route: a Gemini hiccup on the vetter
  // shouldn't block authoring. A weak brief is still refused (422) so
  // the calling engine can surface it to whoever wrote the brief.
  try {
    const vet = await vetBrief({
      specialisation: input.specialisation,
      brief: input.description,
      roleFamily: input.role_family,
      referenceUrls: input.reference_urls ?? [],
    });
    if (!vet.ok) {
      return NextResponse.json(
        {
          error: "brief_too_weak",
          score: vet.score,
          missing: vet.missing,
          suggested_additions: vet.suggested_additions,
        },
        { status: 422 },
      );
    }
  } catch (vetErr) {
    console.warn(
      "[internal/skillboards POST] brief vet failed open:",
      vetErr instanceof Error ? vetErr.message : "unknown",
    );
  }

  const board = await createSkillboard({
    specialisation: input.specialisation,
    description: input.description,
    creationPath: "claude_authored",
    roleFamily: input.role_family,
    parentSkillboardId: input.parent_skillboard_id ?? null,
    claudeAuthoringBrief: input.description,
  });

  try {
    const { skillboardAuthoringJobs } = await import("@/lib/db/schema");
    const { db } = await import("@/lib/db/client");
    await db.insert(skillboardAuthoringJobs).values({
      skillboardId: board.id,
      jobType: "structure",
      result: { reference_urls: input.reference_urls ?? [] } as unknown,
    });
  } catch (err) {
    // Board exists but has no job to populate it — delete rather than
    // leave a permanently empty board for an admin to find later.
    try {
      const { skillboards } = await import("@/lib/db/schema");
      const { db } = await import("@/lib/db/client");
      await db.delete(skillboards).where(eq(skillboards.id, board.id));
    } catch {
      /* best effort */
    }
    return NextResponse.json(
      {
        error: "enqueue_failed",
        message: err instanceof Error ? err.message : "unknown error",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      skillboard_id: board.id,
      specialisation: board.specialisation,
      status: "structure_authoring_pending",
    },
    { status: 201 },
  );
}
