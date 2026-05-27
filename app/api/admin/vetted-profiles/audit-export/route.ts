/**
 * GET /api/admin/vetted-profiles/audit-export?specialisation=X
 *
 * Per-specialisation CSV of every finalised Vetted Talent Profile
 * with overrides + reasoning. Required for hiring-bias audit defence
 * (PRD §Implementation step 30).
 *
 * Permission: superadmin (defensive — this dump contains PII).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  validationOverrides,
  validationResults,
  vettedTalentProfile,
} from "@/lib/db/schema";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const specialisation = searchParams.get("specialisation");
  if (!specialisation) {
    return NextResponse.json(
      { error: "specialisation_required" },
      { status: 400 },
    );
  }

  const profiles = await db
    .select()
    .from(vettedTalentProfile)
    .where(eq(vettedTalentProfile.specialisation, specialisation));

  // Gather overrides keyed by response.
  const overridesByVtpId = new Map<string, string[]>();
  for (const p of profiles) {
    const [vr] = await db
      .select({ id: validationResults.id })
      .from(validationResults)
      .where(eq(validationResults.responseId, p.responseId))
      .limit(1);
    if (!vr) continue;
    const ovs = await db
      .select()
      .from(validationOverrides)
      .where(eq(validationOverrides.validationResultId, vr.id));
    overridesByVtpId.set(
      p.id,
      ovs.map((o) => `${o.field}:${o.reasoning}`),
    );
  }

  // CSV.
  const header = [
    "profile_id",
    "candidate_id",
    "specialisation",
    "claimed_band",
    "final_band",
    "final_level",
    "cadre",
    "confidence",
    "final_source",
    "created_at",
    "overrides",
  ].join(",");

  const rows = profiles.map((p) =>
    [
      p.id,
      p.candidateId,
      escapeCsv(p.specialisation),
      p.claimedBand,
      p.finalBand,
      p.finalLevel,
      p.cadre,
      (p.confidence / 100).toFixed(2),
      p.finalSource,
      p.createdAt.toISOString(),
      escapeCsv((overridesByVtpId.get(p.id) ?? []).join(" | ")),
    ].join(","),
  );

  const csv = [header, ...rows].join("\n");
  const filename = `vetted-profiles-${specialisation.replace(/[^a-z0-9-_]/gi, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function escapeCsv(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
