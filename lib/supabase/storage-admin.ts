/**
 * Supabase admin client — uses the service-role key.
 *
 * Used for:
 *   - Storage: signed upload URLs, signed download URLs, object reads
 *     bypassing RLS.
 *   - Auth admin: inviteUserByEmail, getUserById, signOut, etc.
 *
 * Strictly server-side. Importing this in a Client Component is a bug.
 */

import { createClient } from "@supabase/supabase-js";

let cached: ReturnType<typeof createClient> | undefined;

export function getSupabaseAdmin() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the admin client",
    );
  }
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** @deprecated Use getSupabaseAdmin(). Kept as alias for existing callers. */
export const getStorageAdmin = getSupabaseAdmin;

export const VOICE_BUCKET = "voice-responses";

export function voicePathFor(responseId: string, questionId: string): string {
  // No file extension on the path — the candidate's MediaRecorder may emit
  // webm or mp4 depending on browser; we record the actual MIME elsewhere.
  return `${responseId}/${questionId}`;
}
