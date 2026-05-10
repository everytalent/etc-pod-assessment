/**
 * POST /api/admin/answers/[id]/transcribe
 *
 * Transcribes the voice answer for this row via Gemini 2.0 Flash and
 * persists the result on `answers.transcript`. If a transcript already
 * exists, returns it without re-billing the API (admin can pass
 * { force: true } to re-transcribe).
 *
 * Source audio:
 *   - Supabase Storage (audio_path doesn't start with 'zoho:'): downloaded
 *     via the service-role client.
 *   - Zoho-archived (audio_path starts with 'zoho:'): out of scope for v1
 *     — once audio is archived, we can't easily fetch the bytes back. The
 *     fix is to transcribe BEFORE archiving. Returns 409 with a clear
 *     message so the UI can explain.
 *
 * Permission: editor or above (CAN.scoreOpenEnded would be too lax — this
 * costs API quota and writes to the row).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireEditorApi } from "@/lib/auth/admin";
import { transcribeAudio } from "@/lib/ai/gemini";
import { db } from "@/lib/db/client";
import { answers } from "@/lib/db/schema";
import {
  getStorageAdmin,
  VOICE_BUCKET,
} from "@/lib/supabase/storage-admin";
import { isZohoArchived } from "@/lib/zoho/archive";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const [row] = await db
    .select({
      id: answers.id,
      audioPath: answers.audioPath,
      transcript: answers.transcript,
    })
    .from(answers)
    .where(eq(answers.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!row.audioPath) {
    return NextResponse.json(
      { error: "no_audio", message: "This answer has no voice recording." },
      { status: 400 },
    );
  }
  if (row.transcript && !force) {
    return NextResponse.json({ transcript: row.transcript, cached: true });
  }
  if (isZohoArchived(row.audioPath)) {
    return NextResponse.json(
      {
        error: "audio_archived",
        message:
          "Audio is archived to Zoho — transcribe before archiving next time.",
      },
      { status: 409 },
    );
  }

  // Download the source audio bytes from Supabase Storage.
  const supa = getStorageAdmin();
  const { data: blob, error: dlError } = await supa.storage
    .from(VOICE_BUCKET)
    .download(row.audioPath);
  if (dlError || !blob) {
    return NextResponse.json(
      {
        error: "download_failed",
        message: dlError?.message ?? "Couldn't fetch audio from storage.",
      },
      { status: 502 },
    );
  }

  const audio = await blob.arrayBuffer();
  const mimeType = blob.type || "audio/webm";

  let transcript: string;
  try {
    transcript = await transcribeAudio({ audio, mimeType });
  } catch (err) {
    return NextResponse.json(
      {
        error: "transcription_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }

  await db
    .update(answers)
    .set({ transcript })
    .where(eq(answers.id, id));

  return NextResponse.json({ transcript, cached: false });
}
