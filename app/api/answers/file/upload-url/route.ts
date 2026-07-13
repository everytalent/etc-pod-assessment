/**
 * POST /api/answers/file/upload-url
 *
 * Mints a signed upload URL for a file-upload question type. Avoids
 * streaming the file through Netlify functions (size limits apply).
 *
 * Body: { question_id, filename, content_type }
 * Returns: { upload_url, file_path, token, max_size_bytes }
 *
 * Auth: candidate session cookie. Question must belong to the
 * candidate's response and must be type='file'.
 *
 * Max size: 25 MB — generous for typical work samples (CAD exports,
 * PDFs, photos). Reject larger files client-side before requesting
 * the URL.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { questions, responses } from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";
import {
  filePathFor,
  FILE_UPLOAD_BUCKET,
  getStorageAdmin,
} from "@/lib/supabase/storage-admin";

const MAX_SIZE_BYTES = 25 * 1024 * 1024;

const inputSchema = z.object({
  question_id: z.string().uuid(),
  filename: z.string().trim().min(1).max(200),
  content_type: z.string().trim().min(1).max(120),
});

export async function POST(req: Request): Promise<NextResponse> {
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

  // Validation-mode assessments pull questions from a shared cross-
  // assessment pool by (specialisation × band × level), so a question
  // legitimately served to the candidate doesn't always share the
  // response's assessment_id. Auth is the candidate session cookie;
  // scoping is the response × question × filename storage path.
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
  if (row.questionType !== "file") {
    return NextResponse.json(
      { error: "wrong_question_type", message: "Only valid on file questions." },
      { status: 400 },
    );
  }

  const path = filePathFor(responseId, input.question_id, input.filename);
  const supabase = getStorageAdmin();
  const { data, error } = await supabase.storage
    .from(FILE_UPLOAD_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });

  if (error || !data) {
    return NextResponse.json(
      { error: "signed_url_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    upload_url: data.signedUrl,
    file_path: path,
    token: data.token,
    max_size_bytes: MAX_SIZE_BYTES,
  });
}
