/**
 * POST /api/v1/tenant/assessment-banks/bulk-delete
 *
 * Body: { bank_ids: string[] }
 *
 * Soft-deletes a batch of the tenant's own assessment banks by
 * stamping deleted_at. The rows are retained for ledger and audit;
 * tenant-facing lists filter deleted_at IS NULL, and candidate-facing
 * routes refuse to open a deleted bank.
 *
 * Only banks owned by the caller's tenant are affected — a hostile
 * caller passing another tenant's IDs gets a partial update touching
 * nothing.
 */

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantMemberApi } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";

const inputSchema = z.object({
  bank_ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(req: Request) {
  const auth = await requireTenantMemberApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const removed = await db
    .update(tenantAssessmentBank)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        inArray(tenantAssessmentBank.id, input.bank_ids),
        eq(tenantAssessmentBank.tenantId, auth.session.tenant.id),
      ),
    )
    .returning({ id: tenantAssessmentBank.id });

  return NextResponse.json({
    deleted_count: removed.length,
    deleted_ids: removed.map((r) => r.id),
  });
}
