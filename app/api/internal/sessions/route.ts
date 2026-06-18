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
import { findSkillboardForSpecialisation } from "@/lib/engines/assessment/specialisation-matcher";

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
  //
  // Matching is tolerant (see specialisation-matcher.ts):
  //   - exact, then normalised (case-insensitive + suffix-strip),
  //     then alias map, then Levenshtein ≤ 2.
  // Each spec ends up in exactly one bucket:
  //   - resolved      : ready for validation (board active, bank non-empty)
  //   - unknown       : no matching skillboard at all
  //   - inactive      : skillboard exists but not yet activated by Learning Expert
  //   - empty_banks   : board active but no approved questions yet
  //
  // We then return PARTIAL SUCCESS: as long as ≥1 spec resolves, we mint a
  // session for the resolved ones and surface the rest in `pending_specs`
  // so Onboarding can show "Your X assessment is ready — Y will be when..."
  // rather than blocking the candidate entirely.
  const unknown: string[] = [];
  const inactive: string[] = [];
  const emptyBanks: string[] = [];
  const resolved: { specialisation: string; bankAssessmentId: string }[] = [];
  // For observability + debugging — also collected so we can show admins
  // exactly which matcher strategy landed each spec.
  const matchTrace: {
    requested: string;
    matched_skillboard: string | null;
    strategy: string;
  }[] = [];

  for (const spec of input.specialisations) {
    const m = await findSkillboardForSpecialisation(spec);
    if (m.kind === "miss") {
      matchTrace.push({
        requested: spec,
        matched_skillboard: null,
        strategy: "none",
      });
      unknown.push(spec);
      continue;
    }
    matchTrace.push({
      requested: spec,
      matched_skillboard: m.storedName,
      strategy: m.strategy,
    });
    // Archived boards are effectively unknown — the spec isn't on offer.
    if (m.archivedAt) {
      unknown.push(spec);
      continue;
    }
    if (!m.activatedAt) {
      inactive.push(spec);
      continue;
    }
    // Use the matched skillboard's stored name for bank lookups so we
    // hit the existing sentinel Validation Bank assessment, not a new
    // one keyed by the requested label.
    const bank = await getOrCreateValidationBank(m.storedName);
    const bankQuestionCount = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.assessmentId, bank.id))
      .limit(1);
    if (bankQuestionCount.length === 0) {
      emptyBanks.push(spec);
      continue;
    }
    // We pass the candidate-facing label (input spec) downstream, not the
    // skillboard's stored name — the response & UI surface what the
    // candidate picked, with the matched skillboard's content underneath.
    resolved.push({ specialisation: spec, bankAssessmentId: bank.id });
  }

  // Build pending_specs — every spec that didn't resolve, with its reason.
  // Useful for the Onboarding-side dialog to say "Solar Installation is
  // ready, Site Assessment will email you when ready" rather than blocking
  // the whole session.
  const pendingSpecs: Array<{
    specialisation: string;
    reason: "unknown" | "inactive" | "empty_bank";
  }> = [
    ...unknown.map((s) => ({ specialisation: s, reason: "unknown" as const })),
    ...inactive.map((s) => ({ specialisation: s, reason: "inactive" as const })),
    ...emptyBanks.map((s) => ({
      specialisation: s,
      reason: "empty_bank" as const,
    })),
  ];

  // FAIL only when NO spec resolved — i.e. candidate has nothing to take.
  // Backwards-compat: keep returning the same error codes as v1.0 in the
  // single-spec fail case so existing onboarding-side handlers still match.
  if (resolved.length === 0) {
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: "unknown_specialisation",
          message: `No skillboard for: ${unknown.join(", ")}`,
          unknown,
          pending_specs: pendingSpecs,
          match_trace: matchTrace,
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
          pending_specs: pendingSpecs,
          match_trace: matchTrace,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        error: "validation_bank_empty",
        message: `Validation Bank has zero approved questions for: ${emptyBanks.join(", ")}`,
        empty_banks: emptyBanks,
        pending_specs: pendingSpecs,
        match_trace: matchTrace,
      },
      { status: 422 },
    );
  }
  // From here on: at least one spec resolved. We'll succeed and surface
  // the rest as `pending_specs` in the success payload.

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
  // We insert all rows in two passes so we know every sibling's id
  // before stamping the cross-references onto each metadata. The
  // session walker (in /api/sessions/finalize) uses those ids to
  // route the candidate from one spec's last question to the next
  // spec's first question without going through /done.
  const created: { responseId: string; specialisation: string }[] = [];
  for (const spec of resolved) {
    const placeholderMeta: ResponseMetadata = { path: [] };
    const [row] = await db
      .insert(responses)
      .values({
        assessmentId: spec.bankAssessmentId,
        candidateName: profile.full_name,
        candidateEmail: profile.email,
        candidatePhone: profile.phone ?? null,
        status: "in_progress",
        validationStatus: "pending",
        metadata: placeholderMeta,
      })
      .returning({ id: responses.id });
    created.push({ responseId: row.id, specialisation: spec.specialisation });
  }

  // Pass 2: stamp the full metadata on each row now that we know every
  // sibling's id. sibling_response_ids preserves the original order
  // (the walker advances along it).
  for (const c of created) {
    const siblings = created
      .filter((s) => s.responseId !== c.responseId)
      .map((s) => ({ response_id: s.responseId, specialisation: s.specialisation }));
    const metadata: ResponseMetadata & {
      external_candidate_id: string;
      specialisation: string;
      claimed_band: typeof claimedBand;
      session_expires_at: string;
      redirect_url_after_completion?: string;
      validation_origin: "onboarding_trigger";
      sibling_responses?: { response_id: string; specialisation: string }[];
      walk_order: string[];
    } = {
      path: [],
      external_candidate_id: input.candidate_id,
      specialisation: c.specialisation,
      claimed_band: claimedBand,
      session_expires_at: expiresAt.toISOString(),
      redirect_url_after_completion: input.redirect_url_after_completion,
      validation_origin: "onboarding_trigger",
      sibling_responses: siblings.length > 0 ? siblings : undefined,
      walk_order: created.map((s) => s.responseId),
    };
    await db
      .update(responses)
      .set({ metadata })
      .where(eq(responses.id, c.responseId));
  }

  const primaryToken = created[0].responseId;
  return NextResponse.json(
    {
      session_id: primaryToken,
      token: primaryToken,
      url: buildTakeUrl(primaryToken),
      expires_at: expiresAt.toISOString(),
      specialisations_resolved: resolved.map((r) => r.specialisation),
      // v1.2: partial-success. Specs that didn't make it into the session
      // (no board, not activated, or empty bank) are surfaced here so the
      // Onboarding-side UI can say "Your X is ready — Y will be when we
      // finish setting it up" instead of blocking the whole session.
      pending_specs: pendingSpecs,
      // v1.2: trace of which matcher strategy landed each requested
      // spec on which skillboard. Useful for admin debugging when name
      // drift causes the wrong board to match. Safe to ignore client-side.
      match_trace: matchTrace,
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
