/**
 * PATCH /api/admin/answers/[id]/integrity
 *
 * Set (or clear) the cheating-risk tag on one answer. Triggers a
 * response-level total recompute so the dashboard reflects the
 * adjustment immediately.
 *
 * Body:
 *   { level: 'low' | 'mid' | 'high' | null,
 *     source: 'manual' | 'ai_kimi' | 'ai_gemini' }   // source default 'manual'
 *
 * Auth: any allow-listed admin can tag — same gate as scoring.
 *
 * Scoring effect (applied in recomputeResponseTotals, not on the row):
 *   null / low  → no change to total
 *   mid         → that answer's contribution to total = 0
 *   high        → that answer's contribution to total = score_awarded - 1
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recomputeResponseTotals } from "@/lib/assessment/recompute";
import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers } from "@/lib/db/schema";

const inputSchema = z.object({
  level: z.enum(["low", "mid", "high"]).nullable(),
  source: z.enum(["manual", "ai_kimi", "ai_gemini"]).default("manual"),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [answer] = await db
    .select({ responseId: answers.responseId })
    .from(answers)
    .where(eq(answers.id, id))
    .limit(1);
  if (!answer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await db
    .update(answers)
    .set({
      integrityLevel: input.level,
      integrityLevelSource: input.level === null ? null : input.source,
      integrityLevelSetBy: input.level === null ? null : auth.session.admin.id,
      integrityLevelSetAt: input.level === null ? null : new Date(),
    })
    .where(eq(answers.id, id));

  const totals = await recomputeResponseTotals(answer.responseId);

  return NextResponse.json({
    answer_id: id,
    integrity_level: input.level,
    response_total_score: totals.totalAwarded,
    max_possible: totals.maxPossible,
  });
}
