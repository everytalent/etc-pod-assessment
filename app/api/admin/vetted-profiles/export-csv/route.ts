/**
 * GET /api/admin/vetted-profiles/export-csv
 *
 * One-row-per-(candidate × specialisation) CSV export of every
 * vetted_talent_profile row in the system. Joined to the source
 * response so the CSV also carries candidate identity + submit time.
 *
 * Optional query params:
 *   ?since=YYYY-MM-DD     only rows synthesised on/after this date (UTC)
 *   ?spec=Solar Sales     filter by specialisation (case-sensitive)
 *
 * Permission: editor+ (it's basically aggregated audit data, not raw
 * PII beyond what's already on the response page).
 */

import { and, desc, eq, gte } from "drizzle-orm";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  responses,
  validationResults,
  vettedTalentProfile,
} from "@/lib/db/schema";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const sinceParam = searchParams.get("since");
  const specParam = searchParams.get("spec");

  const conditions = [] as ReturnType<typeof eq>[];
  if (sinceParam) {
    const since = new Date(`${sinceParam}T00:00:00Z`);
    if (!Number.isNaN(since.getTime())) {
      conditions.push(gte(vettedTalentProfile.createdAt, since));
    }
  }
  if (specParam) {
    conditions.push(eq(vettedTalentProfile.specialisation, specParam));
  }

  const rows = await db
    .select({
      candidateId: vettedTalentProfile.candidateId,
      specialisation: vettedTalentProfile.specialisation,
      claimedBand: vettedTalentProfile.claimedBand,
      finalBand: vettedTalentProfile.finalBand,
      finalLevel: vettedTalentProfile.finalLevel,
      cadre: vettedTalentProfile.cadre,
      displayLabel: vettedTalentProfile.displayLabel,
      confidence: vettedTalentProfile.confidence,
      finalSource: vettedTalentProfile.finalSource,
      synthesisedAt: validationResults.synthesisedAt,
      hireRecommendation: validationResults.hireRecommendation,
      requiresHumanReview: validationResults.requiresHumanReview,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      submittedAt: responses.submittedAt,
    })
    .from(vettedTalentProfile)
    .innerJoin(responses, eq(responses.id, vettedTalentProfile.responseId))
    .leftJoin(
      validationResults,
      eq(validationResults.responseId, vettedTalentProfile.responseId),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(vettedTalentProfile.createdAt))
    .limit(10_000);

  // CSV column order is intentional — most-actionable first.
  const cols = [
    "candidate_id",
    "candidate_name",
    "candidate_email",
    "specialisation",
    "cadre",
    "display_label",
    "claimed_band",
    "final_band",
    "final_level",
    "confidence",
    "hire_recommendation",
    "requires_human_review",
    "final_source",
    "submitted_at",
    "synthesised_at",
  ];

  const lines: string[] = [cols.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csv(r.candidateId),
        csv(r.candidateName),
        csv(r.candidateEmail),
        csv(r.specialisation),
        csv(r.cadre),
        csv(r.displayLabel),
        csv(r.claimedBand),
        csv(r.finalBand),
        csv(r.finalLevel),
        String(r.confidence),
        csv(r.hireRecommendation ?? ""),
        r.requiresHumanReview ? "true" : "false",
        csv(r.finalSource),
        csv(r.submittedAt?.toISOString() ?? ""),
        csv(r.synthesisedAt?.toISOString() ?? ""),
      ].join(","),
    );
  }

  const body = lines.join("\n");
  const filename = `vetted-profiles-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Minimal CSV cell escaping — wrap in quotes if contains comma/quote/newline. */
function csv(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
