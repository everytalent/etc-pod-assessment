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

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { finalizeResponse } from "@/lib/assessment/engine";
import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";
import {
  clearCandidateSession,
  getCandidateSession,
  setCandidateSession,
} from "@/lib/session";

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
      metadata: responses.metadata,
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

  // Multi-spec walker: if the just-finished response was part of a
  // multi-spec session (POST /api/internal/sessions created multiple
  // responses for the same candidate, one per spec), advance the
  // candidate to the next pending sibling instead of /done.
  const meta = (row.metadata ?? {}) as ResponseMetadata & {
    walk_order?: string[];
    sibling_responses?: { response_id: string; specialisation: string }[];
  };
  if (meta.walk_order && meta.walk_order.length > 1) {
    const nextSiblingId = await findNextPendingSibling(
      responseId,
      meta.walk_order,
    );
    if (nextSiblingId) {
      const [nextRow] = await db
        .select({ slug: assessments.slug })
        .from(responses)
        .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
        .where(eq(responses.id, nextSiblingId))
        .limit(1);
      if (nextRow) {
        await setCandidateSession(nextSiblingId);
        const nextUrl = new URL(
          `/assess/${nextRow.slug}/session`,
          req.url,
        );
        return NextResponse.redirect(nextUrl, 303);
      }
    }
  }

  await clearCandidateSession();
  return NextResponse.redirect(doneUrl, 303);
}

/**
 * Given the just-finished response and its walk_order array, return
 * the id of the next sibling response that's still in_progress (or
 * null if all sibling specs are done).
 *
 * Walk order preserves the original spec ordering from the POST
 * /api/internal/sessions call — first-listed spec walked first.
 */
async function findNextPendingSibling(
  justFinishedId: string,
  walkOrder: string[],
): Promise<string | null> {
  const remaining = walkOrder.filter((id) => id !== justFinishedId);
  if (remaining.length === 0) return null;

  const rows = await db
    .select({ id: responses.id, status: responses.status })
    .from(responses)
    .where(
      and(
        inArray(responses.id, remaining),
        eq(responses.status, "in_progress"),
      ),
    );
  const stillOpen = new Set(rows.map((r) => r.id));

  // Walk in the original order; pick the first one still open.
  for (const id of walkOrder) {
    if (id === justFinishedId) continue;
    if (stillOpen.has(id)) return id;
  }
  return null;
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
