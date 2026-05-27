/**
 * GET /api/admin/responses/[id]/vetted-profile
 *
 * Returns the full Vetted Talent Profile bundle for one response —
 * the validation_results row + per-spec vetted_talent_profile rows +
 * historical overrides.
 *
 * Permission: editor+.
 */

import { NextResponse } from "next/server";

import { requireEditorApi } from "@/lib/auth/admin";
import { getProfileBundleByResponse } from "@/lib/engines/assessment/profile/repository";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const bundle = await getProfileBundleByResponse(id);
  if (!bundle) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(bundle);
}
