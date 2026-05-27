/**
 * Vetted Talent Profile repository.
 *
 * Reads return the full profile bundle (validation_results + per-spec
 * vetted_talent_profile rows) for the admin drill-in and the public
 * profile contract. Writes are gated by the route's permission check.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  validationOverrides,
  validationResults,
  vettedTalentProfile,
  type HireRecommendation,
  type OverrideField,
  type ValidationOverride,
  type ValidationResult,
  type VettedTalentProfile,
} from "@/lib/db/schema";

export type ProfileBundle = {
  validation_result: ValidationResult;
  profiles: VettedTalentProfile[];
  overrides: ValidationOverride[];
};

export async function getProfileBundleByResponse(
  responseId: string,
): Promise<ProfileBundle | null> {
  const [result] = await db
    .select()
    .from(validationResults)
    .where(eq(validationResults.responseId, responseId))
    .limit(1);
  if (!result) return null;

  const profiles = await db
    .select()
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.responseId, responseId));

  const overrides = await db
    .select()
    .from(validationOverrides)
    .where(eq(validationOverrides.validationResultId, result.id))
    .orderBy(desc(validationOverrides.overriddenAt));

  return {
    validation_result: result,
    profiles,
    overrides,
  };
}

/**
 * Public profile read for the cross-engine contract. Joins
 * validation_results to give Matching / POD a single canonical shape.
 */
export async function getPublicProfileByCandidate(
  candidateId: string,
): Promise<{
  candidate_id: string;
  hire_recommendation: HireRecommendation;
  confidence: number;
  per_spec: Array<VettedTalentProfile>;
  generated_at: string;
} | null> {
  // Most-recent validation_results that produced profiles for this candidate.
  const profiles = await db
    .select()
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.candidateId, candidateId))
    .orderBy(desc(vettedTalentProfile.createdAt));
  if (profiles.length === 0) return null;

  const [result] = await db
    .select()
    .from(validationResults)
    .where(eq(validationResults.responseId, profiles[0].responseId))
    .limit(1);
  if (!result) return null;

  return {
    candidate_id: candidateId,
    hire_recommendation: result.hireRecommendation,
    confidence: result.confidence / 100,
    per_spec: profiles,
    generated_at: result.synthesisedAt?.toISOString() ?? result.createdAt.toISOString(),
  };
}

/* ---------- Override writes ---------- */

export type OverridePatch = {
  field: OverrideField;
  oldValue: unknown;
  newValue: unknown;
  reasoning: string;
  overriddenBy: string;
};

export async function applyOverride(args: {
  validationResultId: string;
  vettedTalentProfileId?: string;
  patch: OverridePatch;
}): Promise<void> {
  await db.insert(validationOverrides).values({
    validationResultId: args.validationResultId,
    vettedTalentProfileId: args.vettedTalentProfileId ?? null,
    field: args.patch.field,
    oldValue: args.patch.oldValue,
    newValue: args.patch.newValue,
    reasoning: args.patch.reasoning,
    overriddenBy: args.patch.overriddenBy,
  });

  // Apply the new value to the right row depending on field.
  if (args.patch.field === "hire_recommendation") {
    await db
      .update(validationResults)
      .set({
        hireRecommendation: args.patch.newValue as HireRecommendation,
        finalSource: "human_override",
        updatedAt: new Date(),
      })
      .where(eq(validationResults.id, args.validationResultId));
    return;
  }

  if (!args.vettedTalentProfileId) {
    throw new Error(`Override field ${args.patch.field} requires a vetted_talent_profile_id`);
  }

  const updates: Record<string, unknown> = {
    finalSource: "human_override",
    updatedAt: new Date(),
  };
  if (args.patch.field === "band") {
    updates.finalBand = args.patch.newValue;
  } else if (args.patch.field === "level") {
    updates.finalLevel = args.patch.newValue;
  } else if (args.patch.field === "mindset_profile") {
    updates.mindsetProfile = args.patch.newValue;
  } else if (args.patch.field === "qualified_scopes") {
    updates.qualifiedScopes = args.patch.newValue;
  } else if (args.patch.field === "reservation_flags") {
    updates.reservationFlags = args.patch.newValue;
  }

  await db
    .update(vettedTalentProfile)
    .set(updates)
    .where(
      and(
        eq(vettedTalentProfile.id, args.vettedTalentProfileId),
        eq(vettedTalentProfile.responseId, args.validationResultId), // safety
      ),
    );
}

/**
 * Decide whether an override requires reasoning per PRD §7.
 * Returns true for: band shifts, hire/no-hire flips, scope add/remove.
 */
export function overrideRequiresReasoning(
  field: OverrideField,
  oldValue: unknown,
  newValue: unknown,
): boolean {
  if (field === "band") return oldValue !== newValue;
  if (field === "hire_recommendation") {
    const oldFlip = oldValue === "hire" || oldValue === "no_hire";
    const newFlip = newValue === "hire" || newValue === "no_hire";
    return oldFlip !== newFlip || oldValue !== newValue;
  }
  if (field === "qualified_scopes") {
    const oldSet = new Set(Array.isArray(oldValue) ? oldValue : []);
    const newSet = new Set(Array.isArray(newValue) ? newValue : []);
    if (oldSet.size !== newSet.size) return true;
    for (const v of oldSet) if (!newSet.has(v)) return true;
    return false;
  }
  return false;
}
