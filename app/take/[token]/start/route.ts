/**
 * POST /take/[token]/start
 *
 * Server route that:
 *   - validates the token resolves to a real validation-mode response
 *   - sets the candidate session cookie to response.id
 *   - returns 200; the client then navigates to /assess/<slug>/session
 *
 * No body required.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { setCandidateSession } from "@/lib/session";

export async function POST(
  _req: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: responses.id,
      submittedAt: responses.submittedAt,
      metadata: responses.metadata,
      mode: assessments.mode,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, token))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.submittedAt) {
    return NextResponse.json({ error: "already_completed" }, { status: 409 });
  }
  if (row.mode !== "validation") {
    return NextResponse.json({ error: "wrong_mode" }, { status: 422 });
  }

  const meta = (row.metadata ?? {}) as ResponseMetadata & {
    session_expires_at?: string;
  };
  if (
    meta.session_expires_at &&
    new Date(meta.session_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  await setCandidateSession(row.id);
  return NextResponse.json({ ok: true });
}
