/**
 * POST /api/score/[responseId] — finalise + return the score breakdown.
 *
 * Normally /api/answers handles finalisation when the candidate hits the last
 * question. This endpoint exists for explicit close-out and idempotent retry:
 *
 *   - If the response is already 'submitted', returns its persisted scores.
 *   - If still 'in_progress', runs finalizeResponse() and returns the result.
 *
 * The URL parameter is public (it's the response UUID), so we still require
 * the candidate session cookie and verify it matches.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { responses } from "@/lib/db/schema";
import { finalizeResponse } from "@/lib/assessment/engine";
import type { FinalizeResponse } from "@/lib/assessment/validators";
import { getCandidateSession } from "@/lib/session";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ responseId: string }> },
) {
  const { responseId } = await params;

  const cookieResponseId = await getCandidateSession();
  if (!cookieResponseId || cookieResponseId !== responseId) {
    return NextResponse.json(
      { error: "session_mismatch" },
      { status: 403 },
    );
  }

  const [row] = await db
    .select({
      id: responses.id,
      status: responses.status,
      totalScore: responses.totalScore,
      maxPossibleScore: responses.maxPossibleScore,
      pass: responses.pass,
    })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Idempotent: if already submitted, just return the stored values.
  if (row.status === "submitted") {
    const payload: FinalizeResponse = {
      total_score: row.totalScore ?? 0,
      max_possible_score: row.maxPossibleScore,
      pass: row.pass ?? false,
    };
    return NextResponse.json(payload);
  }

  if (row.status === "abandoned") {
    return NextResponse.json(
      { error: "session_abandoned" },
      { status: 409 },
    );
  }

  const final = await finalizeResponse(responseId);
  const payload: FinalizeResponse = {
    total_score: final.totalScore,
    max_possible_score: final.maxPossibleScore,
    pass: final.pass,
  };
  return NextResponse.json(payload);
}
