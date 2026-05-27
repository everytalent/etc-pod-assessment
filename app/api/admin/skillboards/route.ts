/**
 * /api/admin/skillboards
 *
 *   GET  — list all skillboards (lightweight; pending-cell counts included)
 *   POST — create a new skillboard (claude_authored path; upload path is Phase 1E)
 *
 * POST flow:
 *   1. Validate body via createSkillboardClaudeInputSchema
 *   2. Vet the brief via Gemini Flash — 422 if too vague
 *   3. Insert skillboard row
 *   4. Run structure authoring (sync, ~5-30s)
 *   5. Return 201 with skillboard_id + tasksEnqueued
 *
 * Permission: editor or above.
 * Claude authoring spends Opus tokens — gated by the editor tier (we
 * don't want assessors triggering paid AI calls).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireSkillboardAccessApi } from "@/lib/auth/admin";
import { vetBrief } from "@/lib/engines/assessment/skillboards/brief-validator";
import { runStructureAuthoring } from "@/lib/engines/assessment/skillboards/claude-author";
import {
  createSkillboard,
  getSkillboardBySpecialisation,
  listSkillboards,
} from "@/lib/engines/assessment/skillboards/repository";
import {
  createSkillboardClaudeInputSchema,
  createSkillboardInputSchema,
} from "@/lib/engines/assessment/skillboards/types";

export async function GET(): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  const rows = await listSkillboards();
  return NextResponse.json({ skillboards: rows });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    const body = await req.json();
    input = createSkillboardInputSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Upload path is Phase 1E.
  if (input.creation_path === "upload") {
    return NextResponse.json(
      {
        error: "not_implemented",
        message: "Excel upload path lands in Phase 1E.",
      },
      { status: 501 },
    );
  }

  // Claude path from here.
  const claudeInput = input as ReturnType<
    typeof createSkillboardClaudeInputSchema.parse
  >;

  // Unique by specialisation. If a row already exists AND has been
  // populated (has skills), refuse — caller should patch instead. If
  // the row is orphaned (created but structure call failed afterwards),
  // delete it and proceed with a fresh attempt.
  const existing = await getSkillboardBySpecialisation(claudeInput.specialisation);
  if (existing) {
    const { db: dbForCleanup } = await import("@/lib/db/client");
    const { skills } = await import("@/lib/db/schema");
    const skillRows = await dbForCleanup
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.skillboardId, existing.id))
      .limit(1);
    const isOrphan = skillRows.length === 0 && !existing.activatedAt;
    if (!isOrphan) {
      return NextResponse.json(
        {
          error: "specialisation_exists",
          message: `A skillboard for "${claudeInput.specialisation}" already exists.`,
          existing_id: existing.id,
        },
        { status: 409 },
      );
    }
    // Orphan — delete the row and continue. CASCADE deletes the
    // (zero) related rows; safe.
    const { skillboards } = await import("@/lib/db/schema");
    await dbForCleanup.delete(skillboards).where(eq(skillboards.id, existing.id));
  }

  // Pre-flight: vet the brief before we spend Opus tokens.
  // Pass reference URLs so the vetter gives credit when the brief
  // delegates a quality criterion to a linked doc.
  //
  // Fail-open: if the vet itself errors (Gemini 503/429/down/etc), we
  // log and proceed. Vetting is a quality filter, not a hard gate —
  // a transient Gemini issue should not block authoring. The user can
  // re-author the board if cells come out weak.
  try {
    const vet = await vetBrief({
      specialisation: claudeInput.specialisation,
      brief: claudeInput.description,
      roleFamily: claudeInput.role_family,
      referenceUrls: claudeInput.reference_urls ?? [],
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
      "[skillboards POST] brief vet failed open:",
      vetErr instanceof Error ? vetErr.message : "unknown",
    );
    // Proceed without vet result. Don't block on infra issues.
  }

  // Persist the row first so the structure call has a target for skill insertion.
  const board = await createSkillboard({
    specialisation: claudeInput.specialisation,
    description: claudeInput.description,
    creationPath: "claude_authored",
    roleFamily: claudeInput.role_family,
    parentSkillboardId: claudeInput.parent_skillboard_id ?? null,
    claudeAuthoringBrief: claudeInput.description,
  });

  // Synchronous structure pass — kicks off task_cells jobs in the queue.
  try {
    const result = await runStructureAuthoring({
      skillboardId: board.id,
      args: {
        specialisation: claudeInput.specialisation,
        brief: claudeInput.description,
        referenceUrls: claudeInput.reference_urls ?? [],
      },
    });
    return NextResponse.json(
      {
        skillboard_id: board.id,
        tasks_enqueued: result.tasksEnqueued,
        retried: result.retried,
      },
      { status: 201 },
    );
  } catch (err) {
    // Structure call failed — board exists but is empty. Return 502 so
    // the UI surfaces an actionable error; admin can retry from the
    // detail page or delete the board and start over.
    return NextResponse.json(
      {
        error: "structure_authoring_failed",
        message: err instanceof Error ? err.message : "unknown error",
        skillboard_id: board.id,
      },
      { status: 502 },
    );
  }
}
