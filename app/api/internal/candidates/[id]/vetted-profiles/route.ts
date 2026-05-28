/**
 * GET /api/internal/candidates/[id]/vetted-profiles
 *
 * Cross-engine endpoint — podsproject's talent profile page calls this
 * to render the candidate's vetted results across every spec they've
 * been validated for.
 *
 * See: docs/2026-05-28-validation-trigger-contract-v1.0.md (endpoint 2).
 *
 * Pull model rationale: vetted profiles are mutable (admin overrides land
 * any time). A push snapshot would drift. Profile page always shows
 * current state.
 *
 * Query params:
 *   include_history=true → returns a `history` array per spec, oldest-first.
 *                          Default false (only latest per spec).
 *
 * Auth: Bearer token matches ETC_ASSESSMENT_SERVICE_TOKEN.
 */

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { db } from "@/lib/db/client";
import {
  responses,
  validationResults,
  vettedTalentProfile,
  type VettedTalentProfile,
} from "@/lib/db/schema";

type SpecProfileOut = {
  specialisation: string;
  validated_at: string;
  claimed_band: string;
  final_band: string;
  final_level: string;
  display_label: string;
  cadre: string;
  confidence: number;
  hire_recommendation: string;
  requires_human_review: boolean;
  per_skill_breakdown: unknown;
  mindset_profile: unknown;
  qualified_scopes: unknown;
  reservation_flags: unknown;
  rationale: string;
  final_source: string;
};

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = extractBearer(req);
  if (!isValidServiceToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: candidateId } = await context.params;
  const { searchParams } = new URL(req.url);
  const includeHistory = searchParams.get("include_history") === "true";

  // Pull all vetted profile rows for this candidate, plus the matching
  // validation_results row to populate hire_recommendation +
  // requires_human_review (which live on the result, not the profile).
  const rows = await db
    .select({
      profile: vettedTalentProfile,
      hireRecommendation: validationResults.hireRecommendation,
      requiresHumanReview: validationResults.requiresHumanReview,
      synthesisedAt: validationResults.synthesisedAt,
    })
    .from(vettedTalentProfile)
    .leftJoin(
      validationResults,
      eq(validationResults.responseId, vettedTalentProfile.responseId),
    )
    .leftJoin(responses, eq(responses.id, vettedTalentProfile.responseId))
    .where(eq(vettedTalentProfile.candidateId, candidateId))
    .orderBy(desc(vettedTalentProfile.updatedAt));

  if (rows.length === 0) {
    // 200 with empty profiles is correct per the contract (candidate
    // may exist in Onboarding but have never been validated).
    return NextResponse.json({ candidate_id: candidateId, profiles: [] });
  }

  const shaped = rows.map((r) =>
    shapeProfile(r.profile, {
      hire_recommendation: r.hireRecommendation,
      requires_human_review: r.requiresHumanReview ?? false,
      synthesised_at: r.synthesisedAt,
    }),
  );

  if (!includeHistory) {
    // Group by specialisation, keep latest only (sorted desc by updatedAt
    // above; first occurrence per spec wins).
    const seen = new Set<string>();
    const latest: SpecProfileOut[] = [];
    for (const p of shaped) {
      if (!seen.has(p.specialisation)) {
        seen.add(p.specialisation);
        latest.push(p);
      }
    }
    return NextResponse.json({
      candidate_id: candidateId,
      profiles: latest,
    });
  }

  // include_history=true: group by spec, attach history array.
  const bySpec = new Map<string, SpecProfileOut[]>();
  for (const p of shaped) {
    const list = bySpec.get(p.specialisation) ?? [];
    list.push(p);
    bySpec.set(p.specialisation, list);
  }
  const withHistory = Array.from(bySpec.entries()).map(([spec, list]) => ({
    ...list[0], // latest
    history: list.slice(1).reverse(), // older entries, oldest-first
    specialisation: spec,
  }));
  return NextResponse.json({
    candidate_id: candidateId,
    profiles: withHistory,
  });
}

function shapeProfile(
  p: VettedTalentProfile,
  extra: {
    hire_recommendation: string | null;
    requires_human_review: boolean;
    synthesised_at: Date | null;
  },
): SpecProfileOut {
  return {
    specialisation: p.specialisation,
    validated_at: (extra.synthesised_at ?? p.updatedAt).toISOString(),
    claimed_band: p.claimedBand,
    final_band: p.finalBand,
    final_level: p.finalLevel,
    display_label: p.displayLabel,
    cadre: p.cadre,
    confidence: p.confidence,
    hire_recommendation: extra.hire_recommendation ?? "requires_human_review",
    requires_human_review: extra.requires_human_review,
    per_skill_breakdown: p.perSkillBreakdown,
    mindset_profile: p.mindsetProfile,
    qualified_scopes: p.qualifiedScopes,
    reservation_flags: p.reservationFlags,
    rationale: p.rationale,
    final_source: p.finalSource,
  };
}
