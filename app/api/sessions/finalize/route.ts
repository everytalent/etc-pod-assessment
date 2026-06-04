/**
 * GET /api/sessions/finalize  (also POST, idempotent)
 *
 * Called by the candidate session page (a Server Component) when there
 * are no more questions to serve. Server Components can't mutate
 * cookies in Next.js 16, so the finalize chain — which clears the
 * candidate session cookie + can trigger Kimi synthesis + Onboarding
 * callback — has to live in a Route Handler.
 *
 * Reads candidate session from cookie. On success, 303-redirects the
 * browser to /assess/<slug>/done. On failure, returns JSON 5xx.
 *
 * Idempotent — if the response is already submitted, just bounces to
 * /done without re-running the chain.
 */

import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { finalizeResponse } from "@/lib/assessment/engine";
import { db } from "@/lib/db/client";
import { assessments, responses } from "@/lib/db/schema";
import { clearCandidateSession, getCandidateSession } from "@/lib/session";

async function handle(req: Request): Promise<NextResponse> {
  const responseId = await getCandidateSession();
  if (!responseId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const [row] = await db
    .select({
      id: responses.id,
      status: responses.status,
      assessmentId: responses.assessmentId,
      assessmentSlug: assessments.slug,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const doneUrl = new URL(`/assess/${row.assessmentSlug}/done`, req.url);

  if (row.status === "submitted") {
    // Already finalized — bounce to /done.
    await clearCandidateSession();
    return NextResponse.redirect(doneUrl, 303);
  }

  // Snapshot caller IP for the integrity panel.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const submitIpHash = ip
    ? createHash("sha256").update(ip).digest("hex").slice(0, 32)
    : undefined;

  try {
    await finalizeResponse(responseId, submitIpHash);
  } catch (err) {
    console.error(
      "[sessions/finalize] finalizeResponse threw:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(
      {
        error: "finalize_failed",
        message:
          err instanceof Error ? err.message.slice(0, 240) : "unknown error",
      },
      { status: 502 },
    );
  }

  await clearCandidateSession();
  return NextResponse.redirect(doneUrl, 303);
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
