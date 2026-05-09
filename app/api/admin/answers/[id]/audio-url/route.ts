/**
 * GET /api/admin/answers/[id]/audio-url
 *
 * Mints a short-lived signed playback URL for the audio attached to this
 * answer. The bucket is private — admins get a 1-hour signed URL each time
 * they open the drill-in, generated on-demand via the service-role key.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers } from "@/lib/db/schema";
import { getStorageAdmin, VOICE_BUCKET } from "@/lib/supabase/storage-admin";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  const [answer] = await db
    .select({ audioPath: answers.audioPath })
    .from(answers)
    .where(eq(answers.id, id))
    .limit(1);

  if (!answer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!answer.audioPath) {
    return NextResponse.json({ error: "no_audio" }, { status: 404 });
  }

  const supabase = getStorageAdmin();
  const { data, error } = await supabase.storage
    .from(VOICE_BUCKET)
    .createSignedUrl(answer.audioPath, SIGNED_URL_TTL_SECONDS);

  if (error || !data) {
    return NextResponse.json(
      { error: "signed_url_failed", message: error?.message ?? "unknown" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: data.signedUrl,
    expires_in_seconds: SIGNED_URL_TTL_SECONDS,
  });
}
