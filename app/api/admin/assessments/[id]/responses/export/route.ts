/**
 * GET /api/admin/assessments/[id]/responses/export — CSV download.
 *
 * Streams the CSV built by lib/admin/responses-csv as a `text/csv`
 * attachment. Editor or above (CAN.exportResponses).
 */

import { NextResponse } from "next/server";

import { buildResponsesCsv } from "@/lib/admin/responses-csv";
import { requireEditorApi } from "@/lib/auth/admin";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let result;
  try {
    result = await buildResponsesCsv({ assessmentId: id });
  } catch (err) {
    if (err instanceof Error && err.message === "Assessment not found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }

  const filename = `${result.assessmentSlug}-responses-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-cache, no-store",
    },
  });
}
