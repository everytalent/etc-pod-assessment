/**
 * DELETE /api/v1/tenant/candidate-responses/[id]
 *
 * Remove one candidate's submission: a test run, a duplicate, someone sent
 * the link by mistake. Permanent; answers and scores go with it. Admins only,
 * like overrides.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTenantAdminApi } from "@/lib/auth/tenant";
import { deleteTenantResponse } from "@/lib/tenant/delete-response";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireTenantAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const result = await deleteTenantResponse({ responseId: id, tenantId: auth.session.tenant.id });
  if (result === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
