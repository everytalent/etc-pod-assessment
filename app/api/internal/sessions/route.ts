/**
 * POST /api/internal/sessions
 *
 * Cross-engine endpoint — Onboarding (podsproject on Railway) calls this
 * to mint a validation session for a candidate.
 *
 * See: docs/2026-05-28-validation-trigger-contract-v1.0.md (endpoint 1).
 *
 * Auth: Bearer token matches ETC_ASSESSMENT_SERVICE_TOKEN (or the legacy
 * ETC_PROFILE_SERVICE_TOKENS list).
 *
 * Behaviour:
 *   1. Validate body + auth
 *   2. Fetch candidate profile via getOnboardingProfile (404 if not found)
 *   3. For each specialisation: confirm an activated skillboard + sentinel
 *      Validation Bank assessment with ≥1 approved question
 *   4. Check for an existing open session (pending/in_progress) for the same
 *      (candidate_id, sorted specs) → 409 with existing session URL
 *   5. Create one `responses` row per specialisation (multi-spec flow uses
 *      one walker session that visits each in turn — implemented downstream
 *      as the candidate steps through specs in /take/[token])
 *   6. Return { session_id, token, url, expires_at, specialisations_resolved }
 *
 * MVP simplification: token == responses[0].id (first spec's row). 36-char
 * UUID, opaque, cryptographically random. /take/[token] resolves it back.
 */

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";
import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  responses,
  skillboards,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { deduceBand } from "@/lib/engines/assessment/band-deducer";
import { getOnboardingProfile } from "@/lib/engines/assessment/onboarding-client";
import { getOrCreateValidationBank } from "@/lib/engines/assessment/proposals/validation-bank";

const inputSchema = z.object({
  candidate_id: z.string().trim().min(1).max(60),
  specialisations: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
  redirect_url_after_completion: z.string().url().max(500).optional(),
  expires_in_days: z.number().int().min(1).max(30).default(7),
});

export async function POST(req: Request): Promise<NextResponse> {
  // ---------- 1. Auth ----------
  const token = extractBearer(req);
  if (!isValidServiceToken(token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---------- 2. Parse body ----------
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

  // ---------- 3. Fetch candidate profile via v1.1 contract ----------
  let profile;
  try {
    profile = await getOnboardingProfile(input.candidate_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    if (msg.includes("404") || msg.toLowerCase().includes("not_found")) {
      return NextResponse.json(
        {
          error: "candidate_not_found",
          message: "Onboarding has no profile for this candidate_id.",
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: "onboarding_unreachable",
        message: `Could not fetch candidate profile: ${msg}`,
      },
      { status: 502 },
    );
  }
  if (!profile) {
    return NextResponse.json(
      {
        error: "candidate_not_found",
        message: "Onboarding returned no profile for this candidate_id.",
      },
      { status: 404 },
    );
  }

  // ---------- 4. Validate each specialisation has an active board + bank ----------
  const unknown: string[] = [];
  const inactive: string[] = [];
  const emptyBanks: string[] = [];
  const resolved: { specialisation: string; bankAssessmentId: string }[] = [];

  for (const spec of input.specialisations) {
    const [board] = await db
      .select({
        id: skillboards.id,
        activatedAt: skillboards.activatedAt,
        archivedAt: skillboards.archivedAt,
      })
      .from(skillboards)
      .where(eq(skillboards.specialisation, spec))
      .limit(1);
    // Treat archived boards as "unknown" from the caller's perspective —
    // the spec genuinely isn't available for new sessions, even if it
    // existed historically.
    if (!board || board.archivedAt) {
      unknown.push(spec);
      continue;
    }
    if (!board.activatedAt) {
      inactive.push(spec);
      continue;
    }
    const bank = await getOrCreateValidationBank(spec);
    const bankQuestionCount = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.assessmentId, bank.id))
      .limit(1);
    if (bankQuestionCount.length === 0) {
      emptyBanks.push(spec);
      continue;
    }
    resolved.push({ specialisation: spec, bankAssessmentId: bank.id });
  }

  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: "unknown_specialisation",
        message: `No skillboard for: ${unknown.join(", ")}`,
        unknown,
      },
      { status: 422 },
    );
  }
  if (inactive.length > 0) {
    return NextResponse.json(
      {
        error: "skillboard_not_activated",
        message: `Skillboard(s) exist but not activated: ${inactive.join(", ")}`,
        inactive,
      },
      { status: 422 },
    );
  }
  if (emptyBanks.length > 0) {
    return NextResponse.json(
      {
        error: "validation_bank_empty",
        message: `Validation Bank has zero approved questions for: ${emptyBanks.join(", ")}`,
        empty_banks: emptyBanks,
      },
      { status: 422 },
    );
  }

  // ---------- 5. Dedupe: existing open session for this (candidate, specs)? ----------
  // Open = status in_progress AND validation_status in (pending, scored). We
  // match on candidate_id stored in metadata and the set of assessment ids
  // resolved above.
  const bankIds = resolved.map((r) => r.bankAssessmentId);
  const openExisting = await db
    .select({
      id: responses.id,
      metadata: responses.metadata,
      assessmentId: responses.assessmentId,
    })
    .from(responses)
    .where(
      and(
        inArray(responses.assessmentId, bankIds),
        eq(responses.status, "in_progress"),
      ),
    );
  const myExisting = openExisting.filter(
    (r) =>
      (r.metadata as { external_candidate_id?: string } | null)
        ?.external_candidate_id === input.candidate_id,
  );
  if (myExisting.length > 0) {
    // Return the first existing session's URL — multi-spec deduping is
    // approximate at MVP (we don't compare the full set).
    const first = myExisting[0];
    const existingMeta = first.metadata as ResponseMetadata & {
      session_expires_at?: string;
    };
    return NextResponse.json(
      {
        error: "session_already_open",
        message: "A pending session already exists for this candidate × spec.",
        existing_session: {
          session_id: first.id,
          token: first.id,
          url: buildTakeUrl(first.id),
          expires_at: existingMeta.session_expires_at ?? null,
        },
      },
      { status: 409 },
    );
  }

  // ---------- 6. Bootstrap claimed band from profile ----------
  // Use the band-deducer rather than profile.years_bucket → band mapping
  // alone, so the result honours override + role signals.
  const banded = deduceBand(profile);
  const claimedBand = banded.band;

  const expiresAt = new Date(
    Date.now() + input.expires_in_days * 24 * 60 * 60 * 1000,
  );

  // ---------- 7. Create one responses row per spec ----------
  // The candidate's URL only resolves the first row's id; downstream the
  // session walker (in /take/[token]) handles transitions across specs.
  const createdIds: string[] = [];
  for (const spec of resolved) {
    const metadata: ResponseMetadata & {
      external_candidate_id: string;
      specialisation: string;
      claimed_band: typeof claimedBand;
      session_expires_at: string;
      redirect_url_after_completion?: string;
      validation_origin: "onboarding_trigger";
      sibling_specs?: string[];
    } = {
      // Existing ResponseMetadata fields default-empty
      path: [],
      // Plus our new validation-session fields:
      external_candidate_id: input.candidate_id,
      specialisation: spec.specialisation,
      claimed_band: claimedBand,
      session_expires_at: expiresAt.toISOString(),
      redirect_url_after_completion: input.redirect_url_after_completion,
      validation_origin: "onboarding_trigger",
      sibling_specs:
        resolved.length > 1
          ? resolved
              .filter((r) => r.specialisation !== spec.specialisation)
              .map((r) => r.specialisation)
          : undefined,
    };

    const [row] = await db
      .insert(responses)
      .values({
        assessmentId: spec.bankAssessmentId,
        candidateName: profile.full_name,
        candidateEmail: profile.email,
        candidatePhone: profile.phone ?? null,
        status: "in_progress",
        validationStatus: "pending",
        metadata,
      })
      .returning({ id: responses.id });
    createdIds.push(row.id);
  }

  const primaryToken = createdIds[0];
  return NextResponse.json(
    {
      session_id: primaryToken,
      token: primaryToken,
      url: buildTakeUrl(primaryToken),
      expires_at: expiresAt.toISOString(),
      specialisations_resolved: resolved.map((r) => r.specialisation),
    },
    { status: 201 },
  );

  void assessments; // keep import used in TS narrowing path
}

function buildTakeUrl(token: string): string {
  const base = (
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.energytalentco.com"
  ).replace(/\/$/, "");
  return `${base}/take/${token}`;
}
