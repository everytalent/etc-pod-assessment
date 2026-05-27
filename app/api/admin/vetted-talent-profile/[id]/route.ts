/**
 * PATCH /api/admin/vetted-talent-profile/[id]
 *
 * Override a field on a Vetted Talent Profile (band, level, mindset,
 * scopes, reservations). Required reasoning kicks in for band shifts,
 * hire flips, and scope changes (PRD §7).
 *
 * Side effect: triggers a learning_summary update for the scope.
 *
 * Permission: editor+.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  overrideFieldEnum,
  validationResults,
  vettedTalentProfile,
} from "@/lib/db/schema";
import {
  applyOverride,
  overrideRequiresReasoning,
} from "@/lib/engines/assessment/profile/repository";
import { updateLearningSummaryOnOverride } from "@/lib/engines/assessment/learning/summary-updater";
import { MIN_OVERRIDE_REASONING_CHARS } from "@/lib/engines/assessment/skillboards/types";

const inputSchema = z.object({
  field: z.enum(overrideFieldEnum.enumValues),
  old_value: z.unknown(),
  new_value: z.unknown(),
  reasoning: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireEditorApi();
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

  // Look up the profile + its validation_result.
  const [profile] = await db
    .select()
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.id, id))
    .limit(1);
  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const [vr] = await db
    .select({ id: validationResults.id })
    .from(validationResults)
    .where(eq(validationResults.responseId, profile.responseId))
    .limit(1);
  if (!vr) {
    return NextResponse.json(
      { error: "no_validation_result" },
      { status: 409 },
    );
  }

  // Reasoning gate.
  if (overrideRequiresReasoning(input.field, input.old_value, input.new_value)) {
    if (
      !input.reasoning ||
      input.reasoning.trim().length < MIN_OVERRIDE_REASONING_CHARS
    ) {
      return NextResponse.json(
        {
          error: "reasoning_required",
          min_chars: MIN_OVERRIDE_REASONING_CHARS,
          message:
            "Band shifts, hire flips, and scope changes require reasoning ≥ 20 chars.",
        },
        { status: 422 },
      );
    }
  }

  await applyOverride({
    validationResultId: vr.id,
    vettedTalentProfileId: id,
    patch: {
      field: input.field,
      oldValue: input.old_value,
      newValue: input.new_value,
      reasoning: input.reasoning ?? "",
      overriddenBy: auth.session.admin.id,
    },
  });

  // Update the learning summary in-process. If it fails (Kimi down,
  // budget cap), the override is still saved; summary will lag.
  try {
    await updateLearningSummaryOnOverride({
      validationResultId: vr.id,
      vettedTalentProfileId: id,
      overriddenBy: auth.session.admin.email,
    });
  } catch {
    // Surface but don't block override save.
  }

  return NextResponse.json({ updated: true });
}
