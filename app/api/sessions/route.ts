/**
 * POST /api/sessions — start a candidate session.
 *
 * Body: { slug, name, email, phone? }
 * Looks up the published assessment by slug, creates a `responses` row in
 * status='in_progress', sets the httpOnly candidate session cookie, and
 * returns the first question (PRD §5.1).
 *
 * Resume-on-refresh and answer submission live in sibling routes.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { ZodError } from "zod";

import { db } from "@/lib/db/client";
import { responses, type ResponseMetadata } from "@/lib/db/schema";
import { getNextQuestion } from "@/lib/assessment/engine";
import {
  getAssessmentBySlug,
  getCandidateQuestion,
} from "@/lib/assessment/queries";
import {
  startSessionSchema,
  type StartSessionResponse,
} from "@/lib/assessment/validators";
import { setCandidateSession } from "@/lib/session";

export async function POST(req: Request) {
  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = startSessionSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const assessment = await getAssessmentBySlug(input.slug);
  if (!assessment || assessment.status !== "published") {
    return NextResponse.json(
      { error: "assessment_not_available" },
      { status: 404 },
    );
  }

  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent") ?? undefined;
  const forwardedFor = headerStore.get("x-forwarded-for") ?? "";
  const ip = forwardedFor.split(",")[0]?.trim() ?? "";
  const ipHash = ip
    ? createHash("sha256").update(ip).digest("hex").slice(0, 32)
    : undefined;

  const [created] = await db
    .insert(responses)
    .values({
      assessmentId: assessment.id,
      candidateName: input.name,
      candidateEmail: input.email,
      candidatePhone: input.phone ?? null,
      status: "in_progress",
      metadata: {
        user_agent: userAgent,
        ip_hash: ipHash,
        path: [],
        // Server-truth timestamp for the timer (PRD §5.2). Persisted as ISO
        // string inside metadata; route handlers read it on answer submit.
        last_question_shown_at: new Date().toISOString(),
      } satisfies ResponseMetadata,
    })
    .returning({ id: responses.id });

  if (!created) {
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  await setCandidateSession(created.id);

  const next = await getNextQuestion(created.id);
  const nextQuestion =
    next.kind === "next"
      ? await getCandidateQuestion(next.questionId)
      : null;

  const payload: StartSessionResponse = {
    response_id: created.id,
    next_question: nextQuestion,
    is_complete: next.kind === "end",
  };
  return NextResponse.json(payload, { status: 201 });
}
