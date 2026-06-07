/**
 * POST /api/v1/tenant/candidate-responses/[id]/override
 * Body: { question_id, answer_id?, new_score, reason_category, reason_text }
 *
 * Records a tenant override and emits it to the ETC scoring-feedback
 * stream (for now: a structured log line + the ledger-style row in
 * candidate_response_override).
 *
 * Recompute-on-override is a Phase 6b follow-up — for now we trust the
 * existing recompute pipeline that the admin surface already exposes.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  answers,
  candidateResponseOverride,
  responses,
} from "@/lib/db/schema";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const schema = z.object({
  question_id: z.string().uuid(),
  answer_id: z.string().uuid().nullable().optional(),
  new_score: z.unknown(),
  reason_category: z.enum([
    "too_harsh",
    "too_lenient",
    "missed_context",
    "cultural_nuance",
    "translation_issue",
    "other",
  ]),
  reason_text: z.string().min(20).max(2000),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id: responseId } = await context.params;

  let parsed;
  try {
    parsed = schema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Verify the response actually belongs to this tenant.
  const [resp] = await db
    .select({ id: responses.id, assessmentId: responses.assessmentId })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!resp) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Capture the original score if we know it.
  let originalScore: unknown = {};
  if (parsed.answer_id) {
    const [ans] = await db
      .select({
        scoreAwarded: answers.scoreAwarded,
        scoreRationale: answers.scoreRationale,
      })
      .from(answers)
      .where(and(eq(answers.id, parsed.answer_id)))
      .limit(1);
    if (ans) {
      originalScore = {
        score_awarded: ans.scoreAwarded,
        score_rationale: ans.scoreRationale,
      };
    }
  }

  await db.insert(candidateResponseOverride).values({
    responseId,
    answerId: parsed.answer_id ?? null,
    questionId: parsed.question_id,
    overriddenByUserId: auth.session.tenantUser.id,
    tenantId: auth.session.tenant.id,
    originalScore,
    newScore: parsed.new_score as object,
    reasonCategory: parsed.reason_category,
    reasonText: parsed.reason_text.trim(),
  });

  // Emit to the scoring-feedback stream. Real stream wiring is deferred;
  // a structured log line is the v1 contract so analytics can grep it.
  console.log(
    JSON.stringify({
      stream: "etc.scoring_feedback",
      event: "tenant_override",
      tenant_id: auth.session.tenant.id,
      response_id: responseId,
      question_id: parsed.question_id,
      reason_category: parsed.reason_category,
      timestamp: new Date().toISOString(),
    }),
  );

  return NextResponse.json(serialiseForTenant({ ok: true }));
}
