/**
 * POST /api/v1/tenant/assessment-banks
 *
 * Creates a new tenant_assessment_bank row in status='queued' and (in
 * Phase 2a) returns immediately with the id. The actual generation
 * pipeline (Phase 2b) is wired through the existing background worker —
 * see lib/engines/tenant-builder/worker.ts.
 *
 * Phase 2a leaves the worker dispatch as a placeholder; the row sits in
 * 'queued' until Phase 2b lands. This is intentional so the UI flow,
 * input validation, and the per-tenant audit trail can be exercised
 * end-to-end before the (much larger) Opus pipeline lands.
 *
 * Payment gating arrives in Phase 4 (this route currently lets every
 * tenant submit unconditionally — drafts are a no-op).
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";
import { canSubmitForGeneration } from "@/lib/tenant/billing/balance";
import { sanitiseUserText } from "@/lib/tenant/sanitise";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const tenantQuestionSchema = z.object({
  text: z.string().min(10).max(1000),
  treatment: z.enum(["use_as_is", "improve"]),
  source: z.enum(["inline", "upload"]).default("inline"),
});

const inputSchema = z.object({
  intake_type: z.enum(["job_description", "scope_of_work"]),
  intake_text: z.string().min(100).max(50_000).transform(sanitiseUserText),
  context_text: z
    .string()
    .max(5000)
    .nullable()
    .optional()
    .transform((v) => (v == null ? v : sanitiseUserText(v))),
  intake_source: z.enum(["paste", "upload"]).default("paste"),
  intake_upload_filename: z.string().max(200).nullable().optional(),
  claimed_seniority: z
    .enum(["junior", "mid", "senior"])
    .nullable()
    .optional(),
  role_location: z
    .string()
    .max(120)
    .transform((v) => sanitiseUserText(v).trim())
    .nullable()
    .optional(),
  tenant_supplied_questions: z
    .array(
      tenantQuestionSchema.extend({
        text: z.string().min(10).max(1000).transform(sanitiseUserText),
      }),
    )
    .max(100)
    .optional(),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;

  let parsed;
  try {
    parsed = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Payment gate (PRD §1a). Tenant needs ≥1 generation credit AND
  // ≥5 candidate slots to enqueue. Without either, redirect-style
  // 402 with the reason so the client lands on /tenant/billing.
  const gate = await canSubmitForGeneration(auth.session.tenant.id);
  if (!gate.ok) {
    return NextResponse.json(
      serialiseForTenant({
        error: "payment_required",
        reason: gate.reason,
        current_balance: gate.current
          ? {
              generation_credits: gate.current.generationCredits,
              candidate_slots: gate.current.candidateSlots,
            }
          : null,
        next: "/tenant/billing",
      }),
      { status: 402 },
    );
  }

  const intakeTextHash = createHash("sha256")
    .update(parsed.intake_text.trim())
    .digest("hex");

  // Dedupe-within-24h: surface existing rows so the tenant doesn't
  // accidentally burn a credit on the same JD twice. Failed banks are
  // explicitly excluded — re-submitting after a failure must always
  // create a fresh bank that flows through current code, otherwise we
  // trap the user on a stale failure they can't escape.
  const [existing] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      createdAt: tenantAssessmentBank.createdAt,
    })
    .from(tenantAssessmentBank)
    .where(eq(tenantAssessmentBank.intakeTextHash, intakeTextHash))
    .limit(1);
  if (existing && existing.status !== "failed") {
    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        serialiseForTenant({
          duplicate: true,
          id: existing.id,
          status: existing.status,
        }),
      );
    }
  }

  const [row] = await db
    .insert(tenantAssessmentBank)
    .values({
      tenantId: auth.session.tenant.id,
      createdByUserId: auth.session.tenantUser.id,
      intakeType: parsed.intake_type,
      intakeText: parsed.intake_text,
      intakeTextHash,
      intakeSource: parsed.intake_source,
      intakeUploadFilename: parsed.intake_upload_filename ?? null,
      contextText: parsed.context_text ?? null,
      claimedSeniority: parsed.claimed_seniority ?? null,
      roleLocation: parsed.role_location || null,
      tenantSuppliedQuestions: parsed.tenant_supplied_questions ?? null,
      status: "queued",
    })
    .returning({ id: tenantAssessmentBank.id, status: tenantAssessmentBank.status });

  // Phase 2b will enqueue the actual generation job here.
  // For Phase 2a the row sits in 'queued' so the UI can poll status.

  return NextResponse.json(
    serialiseForTenant({
      id: row.id,
      status: row.status,
      poll_url: `/api/v1/tenant/assessment-banks/${row.id}`,
    }),
  );
}
