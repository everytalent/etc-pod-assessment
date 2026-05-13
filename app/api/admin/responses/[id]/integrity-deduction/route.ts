/**
 * PATCH /api/admin/responses/[id]/integrity-deduction
 *
 * Set (or clear) the response-level cheating deduction. Applied on top
 * of any per-answer integrity penalties at total roll-up: the dashboard
 * total becomes `max(0, round(integrity_adjusted_sum × (1 − pct/100)))`.
 *
 * Body:
 *   { pct: 0..100 | null,
 *     rationale?: string }   // free-form note kept alongside the pct
 *
 * Auth: editor or above (per CAN.deleteResponses pattern; assessors
 * can tag individual answers but not move a response's total %).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { responses } from "@/lib/db/schema";

const inputSchema = z.object({
  pct: z.number().int().min(0).max(100).nullable(),
  rationale: z.string().trim().max(2000).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: responses.id })
    .from(responses)
    .where(eq(responses.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db
    .update(responses)
    .set({
      integrityDeductionPct: input.pct,
      integrityDeductionRationale:
        input.pct === null ? null : (input.rationale ?? null),
      integrityDeductionSetBy: input.pct === null ? null : auth.session.admin.id,
      integrityDeductionSetAt: input.pct === null ? null : new Date(),
    })
    .where(eq(responses.id, id));

  const totals = await recomputeResponseTotals(id);

  return NextResponse.json({
    integrity_deduction_pct: input.pct,
    response_total_score: totals.totalAwarded,
    max_possible: totals.maxPossible,
  });
}
