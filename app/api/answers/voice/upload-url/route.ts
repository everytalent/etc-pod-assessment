/**
 * POST /api/answers/voice/upload-url
 *
 * Mints a one-shot signed upload URL the candidate's browser can PUT the
 * recorded audio to directly. Avoids streaming 3-5 MB blobs through Netlify
 * functions.
 *
 * Body: { question_id }
 * Returns: { upload_url, audio_path, token }
 *
 * Auth: candidate session cookie. Question must belong to the assessment
 * the cookie's response is for, and must be type='open'.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { questions, responses } from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";
import {
  getStorageAdmin,
  VOICE_BUCKET,
  voicePathFor,
} from "@/lib/supabase/storage-admin";

const inputSchema = z.object({ question_id: z.string().uuid() });

export async function POST(req: Request) {
  const responseId = await getCandidateSession();
  if (!responseId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Validation-mode assessments serve questions from a shared cross-
  // assessment pool by (specialisation × band × level), so a served
  // question doesn't always share the response's assessment_id. Auth
  // is the candidate session cookie; the upload path is scoped to
  // response × question so nothing leaks across candidates.
  const [responseRow] = await db
    .select({ id: responses.id })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!responseRow) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  const [row] = await db
    .select({
      questionId: questions.id,
      questionType: questions.type,
    })
    .from(questions)
    .where(eq(questions.id, input.question_id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "question_not_found" }, { status: 404 });
  }
  // Voice upload is valid for 'open' and 'voice' types. file has its
  // own /api/answers/file/upload-url; formula uses a numeric input.
  if (row.questionType !== "open" && row.questionType !== "voice") {
    return NextResponse.json(
      {
        error: "wrong_question_type",
        message: "Voice upload only valid on open-ended or voice questions.",
      },
      { status: 400 },
    );
  }

  const audioPath = voicePathFor(responseId, input.question_id);

  const supabase = getStorageAdmin();
  const { data, error } = await supabase.storage
    .from(VOICE_BUCKET)
    .createSignedUploadUrl(audioPath, { upsert: true });

  if (error || !data) {
    return NextResponse.json(
      { error: "signed_url_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    upload_url: data.signedUrl,
    audio_path: audioPath,
    token: data.token,
  });
}
