/**
 * GET /api/admin/answers/[id]/audio-url
 *
 * Returns a playback URL for the audio attached to this answer. Resolves
 * by `audio_path` prefix:
 *
 *   - 'zoho:<file_id>'  → direct WorkDrive file URL (admin must be signed
 *                         in to your Zoho team — opens in their browser).
 *   - any other value   → 1-hour signed Supabase Storage URL.
 *
 * The drill-in renders the URL inside an <audio> element. WorkDrive URLs
 * open the Zoho preview in the same tab; they're not a direct media stream
 * — that's a known limitation of cold-tier playback (acceptable since
 * archived audio is rarely played).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers } from "@/lib/db/schema";
import {
  getStorageAdmin,
  VOICE_BUCKET,
} from "@/lib/supabase/storage-admin";
import {
  isZohoArchived,
  zohoFileIdFromPath,
} from "@/lib/zoho/archive";
import { workDriveFileUrl } from "@/lib/zoho/workdrive";

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

  if (isZohoArchived(answer.audioPath)) {
    const fileId = zohoFileIdFromPath(answer.audioPath);
    return NextResponse.json({
      url: workDriveFileUrl(fileId),
      expires_in_seconds: null,
      tier: "zoho",
    });
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
    tier: "supabase",
  });
}
