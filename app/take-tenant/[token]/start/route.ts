/**
 * POST /take-tenant/[token]/start
 *
 * Resolves the token to the tenant's underlying assessment row and
 * creates a fresh `responses` row for this candidate. Returns the
 * response id so the client can land on the sample-runner page with
 * the response in scope.
 *
 * Slot consumption happens on COMPLETION (PRD §7) — not here. Opening
 * the link is free.
 */

import { and, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  tenantAssessmentBank,
  type ResponseMetadata,
} from "@/lib/db/schema";

const schema = z.object({
  candidate_name: z.string().min(2).max(120),
  candidate_email: z.string().email(),
  candidate_phone: z
    .string()
    .trim()
    .min(6)
    .max(40)
    .regex(/^[+0-9()\-\s]+$/),
  accessibility_flag: z.boolean().default(false),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;

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

  const [row] = await db
    .select({
      bankId: tenantAssessmentBank.id,
      tenantId: tenantAssessmentBank.tenantId,
      assessmentId: assessments.id,
    })
    .from(tenantAssessmentBank)
    .innerJoin(
      assessments,
      eq(assessments.slug, tenantAssessmentBank.assessmentLinkToken),
    )
    .where(
      and(
        eq(tenantAssessmentBank.assessmentLinkToken, token),
        eq(tenantAssessmentBank.status, "ready"),
        gte(tenantAssessmentBank.linkExpiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: "assessment_unavailable" },
      { status: 410 },
    );
  }

  // Best-effort IP capture for same-IP cross-candidate detection
  // (Phase 6). x-forwarded-for is the common Netlify/Vercel shape.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  const metadata: ResponseMetadata = {
    tenant_bank_id: row.bankId,
    tenant_id: row.tenantId,
    accessibility_flag: parsed.accessibility_flag,
    candidate_ip_address: ip,
  } as unknown as ResponseMetadata;

  const [response] = await db
    .insert(responses)
    .values({
      assessmentId: row.assessmentId,
      candidateName: parsed.candidate_name,
      candidateEmail: parsed.candidate_email,
      candidatePhone: parsed.candidate_phone,
      status: "in_progress",
      metadata,
    })
    .returning({ id: responses.id });

  return NextResponse.json({ response_id: response.id });
}
