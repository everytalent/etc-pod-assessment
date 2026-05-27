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
    // Structure call failed — board exists but is empty.
    //
    // We auto-delete the half-baked row so the admin doesn't have to
    // hunt through the list to clean up. The brief is preserved in the
    // user's form state; they just resubmit.
    //
    // Surface a friendly message that maps the raw underlying error
    // (Anthropic 429, schema mismatch, missing env var, etc.) to a
    // suggestion the admin can act on.
    const rawMessage = err instanceof Error ? err.message : "unknown error";
    const friendly = mapAuthoringErrorToFriendly(rawMessage);
    try {
      const { skillboards: skillboardsTable } = await import("@/lib/db/schema");
      const { db: dbForCleanup2 } = await import("@/lib/db/client");
      await dbForCleanup2
        .delete(skillboardsTable)
        .where(eq(skillboardsTable.id, board.id));
    } catch (cleanupErr) {
      console.warn(
        "[skillboards POST] failed to delete half-baked board:",
        cleanupErr instanceof Error ? cleanupErr.message : "unknown",
      );
    }
    return NextResponse.json(
      {
        error: "structure_authoring_failed",
        message: friendly.message,
        suggestion: friendly.suggestion,
        retryable: friendly.retryable,
        // Underlying error retained for debugging in logs / network panel,
        // but the form will show `message` + `suggestion` instead.
        raw: rawMessage.slice(0, 240),
      },
      { status: 502 },
    );
  }
}

/**
 * Maps raw error strings from Opus / Anthropic SDK into an actionable
 * pair: a one-sentence reason for the admin, and a concrete next step.
 * Includes a `retryable` hint so the form can offer Retry vs Edit-brief.
 */
function mapAuthoringErrorToFriendly(raw: string): {
  message: string;
  suggestion: string;
  retryable: boolean;
} {
  const lower = raw.toLowerCase();

  // Anthropic key missing
  if (lower.includes("anthropic_api_key") && lower.includes("not set")) {
    return {
      message: "The authoring service is not configured on this server.",
      suggestion:
        "This is an infrastructure issue, not a problem with your brief. Notify the platform admin to add the ANTHROPIC_API_KEY environment variable. Your brief has not been saved.",
      retryable: false,
    };
  }

  // Anthropic rate-limited / overloaded
  if (lower.includes("429") || lower.includes("rate") || lower.includes("overloaded")) {
    return {
      message: "Authoring service is busy right now.",
      suggestion: "Wait 30-60 seconds, then click Create skillboard again. Your brief is still in the form below.",
      retryable: true,
    };
  }

  // Opus refused / safety filter
  if (lower.includes("refused") || lower.includes("safety") || lower.includes("blocked")) {
    return {
      message: "chioma.ai couldn't author this skillboard from the brief as written.",
      suggestion:
        "This usually means the brief mentions a sensitive topic, asks for protected information, or is too abstract for chioma.ai to act on. Rewrite the brief with concrete deliverables and project examples for this role, then resubmit.",
      retryable: true,
    };
  }

  // Schema validation failure on Opus output — usually means the brief
  // is too thin to produce a coherent structure.
  if (lower.includes("schema") || lower.includes("validation") || lower.includes("parse")) {
    return {
      message: "chioma.ai returned a partial result that didn't match the expected structure.",
      suggestion:
        "This usually happens when the brief is too short or ambiguous. Try adding more specifics — typical project size, geography, 2-3 example deliverables, and how this role differs from adjacent specialisations. Then resubmit.",
      retryable: true,
    };
  }

  // Budget cap (Opus monthly limit reached)
  if (lower.includes("budget") || lower.includes("cap") || lower.includes("limit reached")) {
    return {
      message: "The monthly Opus budget cap has been reached.",
      suggestion:
        "This is a billing limit, not a problem with your brief. Notify the platform admin to raise OPUS_MONTHLY_CAP_USD or wait until the next billing month.",
      retryable: false,
    };
  }

  // Network / timeout / 5xx
  if (
    lower.includes("timeout") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("503") ||
    lower.includes("502")
  ) {
    return {
      message: "Couldn't reach the authoring service.",
      suggestion: "Likely a transient network issue. Try again in 30 seconds.",
      retryable: true,
    };
  }

  // Generic fall-through
  return {
    message: "Skillboard authoring failed.",
    suggestion:
      "Try resubmitting. If it fails again, rewrite the brief to be more specific — concrete project size, geography, example deliverables, and how this role differs from adjacent specialisations.",
    retryable: true,
  };
}
