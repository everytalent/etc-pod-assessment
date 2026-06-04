/**
 * POST /api/admin/responses/[id]/retry-onboarding-callback
 *
 * Re-fire the Onboarding completion callback for an already-finalised
 * validation response. Used to verify Onboarding's side of the v1.0
 * trigger contract (endpoint 3) once Victory ships the receiver
 * without having to wait for a fresh candidate session.
 *
 * Pulls the same payload synthesis would have built on the original
 * finalize and POSTs it. Reuses the same retry/backoff/notify_log
 * logic from postValidationCompleted.
 *
 * Permission: superadmin.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  responses,
  vettedTalentProfile,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { postValidationCompleted } from "@/lib/engines/assessment/onboarding-completion-callback";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { id: responseId } = await context.params;

  // Load the response + vetted profile that synthesis already wrote.
  const [row] = await db
    .select({
      submittedAt: responses.submittedAt,
      metadata: responses.metadata,
    })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!row.submittedAt) {
    return NextResponse.json(
      {
        error: "not_submitted",
        message:
          "Candidate hasn't completed this validation yet; nothing to fire.",
      },
      { status: 422 },
    );
  }

  const profiles = await db
    .select({
      specialisation: vettedTalentProfile.specialisation,
      cadre: vettedTalentProfile.cadre,
      displayLabel: vettedTalentProfile.displayLabel,
    })
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.responseId, responseId));

  if (profiles.length === 0) {
    return NextResponse.json(
      {
        error: "no_synthesised_profile",
        message:
          "Synthesis never produced a vetted_talent_profile for this response — nothing to send.",
      },
      { status: 422 },
    );
  }

  const meta = (row.metadata ?? {}) as ResponseMetadata & {
    external_candidate_id?: string;
    redirect_url_after_completion?: string;
  };
  const candidateId = meta.external_candidate_id;
  if (!candidateId) {
    return NextResponse.json(
      {
        error: "missing_external_candidate_id",
        message:
          "Response metadata has no external_candidate_id — this row predates the validation flow.",
      },
      { status: 422 },
    );
  }

  const resultUrl =
    meta.redirect_url_after_completion ??
    `${(process.env.ONBOARDING_API_URL ?? "").replace(/\/$/, "")}/candidate/profile`;

  const result = await postValidationCompleted({
    candidate_id: candidateId,
    session_id: responseId,
    completed_at: row.submittedAt.toISOString(),
    per_spec_summary: profiles.map((p) => ({
      specialisation: p.specialisation,
      cadre: p.cadre,
      display_label: p.displayLabel,
    })),
    result_url: resultUrl,
  });

  return NextResponse.json(result);
}
