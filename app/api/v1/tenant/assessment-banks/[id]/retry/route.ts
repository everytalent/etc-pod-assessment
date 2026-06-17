/**
 * POST /api/v1/tenant/assessment-banks/:id/retry
 *
 * Resets a failed bank back to 'queued' so the worker re-processes it
 * with the current code (useful after a sanitiser or library fix has
 * shipped). Only failed banks can be retried — anything else returns
 * 409 to avoid clobbering in-flight or successful generations.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";

export async function POST(
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
  if (row.status !== "failed") {
    return NextResponse.json(
      { error: "only_failed_banks_can_be_retried", current_status: row.status },
      { status: 409 },
    );
  }

  await db
    .update(tenantAssessmentBank)
    .set({
      status: "queued",
      routeTaken: null,
      failureReason: null,
      durationMs: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantAssessmentBank.id, id),
        eq(tenantAssessmentBank.tenantId, auth.session.tenant.id),
      ),
    );

  return NextResponse.json({ ok: true });
}
