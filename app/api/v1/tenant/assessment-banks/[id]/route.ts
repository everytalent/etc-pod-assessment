/**
 * GET /api/v1/tenant/assessment-banks/:id
 *
 * Returns the bank's status mapped to the four tenant-visible stage
 * labels (PRD §2). Internal fields (route_taken, source_skillboard_id,
 * provisional_framework_id) are stripped by the tenant serialiser.
 *
 * Status to stage mapping (PRD §2 visible labels):
 *   queued | analysing                          -> "reading_role"
 *   calibrating                                 -> "calibrating"
 *   crafting                                    -> "crafting"
 *   finalising                                  -> "finalising"
 *   ready                                       -> "ready"
 *   failed                                      -> "failed"
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import {
  tenantAssessmentBank,
  type TenantAssessmentBankStatus,
} from "@/lib/db/schema";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const STATUS_TO_STAGE: Record<
  TenantAssessmentBankStatus,
  "reading_role" | "calibrating" | "crafting" | "finalising" | "ready" | "failed"
> = {
  queued: "reading_role",
  analysing: "reading_role",
  calibrating: "calibrating",
  crafting: "crafting",
  finalising: "finalising",
  ready: "ready",
  failed: "failed",
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  const [row] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
      assessmentLinkToken: tenantAssessmentBank.assessmentLinkToken,
      linkExpiresAt: tenantAssessmentBank.linkExpiresAt,
      samplePreviewQuestionIds: tenantAssessmentBank.samplePreviewQuestionIds,
      intakeType: tenantAssessmentBank.intakeType,
      failureReason: tenantAssessmentBank.failureReason,
      createdAt: tenantAssessmentBank.createdAt,
      updatedAt: tenantAssessmentBank.updatedAt,
    })
    .from(tenantAssessmentBank)
    .where(
      and(
        eq(tenantAssessmentBank.id, id),
        eq(tenantAssessmentBank.tenantId, auth.session.tenant.id),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    serialiseForTenant({
      id: row.id,
      status: row.status,
      stage: STATUS_TO_STAGE[row.status],
      intake_type: row.intakeType,
      assessment_link:
        row.status === "ready" && row.assessmentLinkToken
          ? `/take/${row.assessmentLinkToken}`
          : null,
      link_expires_at: row.linkExpiresAt?.toISOString() ?? null,
      sample_preview_count: row.samplePreviewQuestionIds.length,
      failure_reason: row.status === "failed" ? row.failureReason : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }),
  );
}

/**
 * DELETE /api/v1/tenant/assessment-banks/:id
 *
 * Soft-deletes an assessment: sets deleted_at so the tenant's list
 * views hide it, but the row is retained for the candidate ledger,
 * audit trail, and any in-flight candidate sessions. Any status is
 * eligible — hiding a ready bank stops new candidates from starting
 * without breaking anyone mid-run.
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

  const result = await db
    .update(tenantAssessmentBank)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tenantAssessmentBank.id, id),
        eq(tenantAssessmentBank.tenantId, auth.session.tenant.id),
      ),
    )
    .returning({ id: tenantAssessmentBank.id });

  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
