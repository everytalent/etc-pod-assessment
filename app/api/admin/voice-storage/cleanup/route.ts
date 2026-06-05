/**
 * POST /api/admin/voice-storage/cleanup
 *
 * Find and delete orphan voice files in Supabase Storage.
 *
 * An "orphan" is a voice file in the bucket whose path doesn't match
 * any `answers.audio_path` row. These accumulate when:
 *   - A candidate uploads but the answer-submit fails before save
 *   - A response is deleted (cascade removes answers but not blob files)
 *   - Manual DB tinkering
 *
 * Body:
 *   { dry_run: boolean }  — default true. dry_run lists what would be
 *                            deleted without touching anything.
 *
 * Permission: superadmin (touches storage directly).
 *
 * Caveat: this enumerates the bucket. For large buckets (many tens of
 * thousands of files) we'd want a paginated walker. The current
 * implementation pulls up to 1000 file references per call.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { answers } from "@/lib/db/schema";
import { getStorageAdmin, VOICE_BUCKET } from "@/lib/supabase/storage-admin";
import { isNotNull } from "drizzle-orm";

const inputSchema = z.object({
  dry_run: z.boolean().default(true),
});

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inputSchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // All known audio_path values referenced by an answer row.
  const referenced = await db
    .select({ path: answers.audioPath })
    .from(answers)
    .where(isNotNull(answers.audioPath));
  const referencedSet = new Set(
    referenced.map((r) => r.path).filter((p): p is string => Boolean(p)),
  );

  // Enumerate all voice files in storage. We walk the top-level
  // (per-response folders) then per-folder, since Supabase's list()
  // is non-recursive by default.
  const supabase = getStorageAdmin();
  const responseDirs = await supabase.storage
    .from(VOICE_BUCKET)
    .list("voice-responses", { limit: 1000 });

  if (responseDirs.error) {
    return NextResponse.json(
      {
        error: "storage_list_failed",
        message: responseDirs.error.message,
      },
      { status: 502 },
    );
  }

  const orphans: string[] = [];
  let totalFilesInspected = 0;

  for (const dir of responseDirs.data ?? []) {
    // dir.name is the response_id directory
    if (!dir.id && !dir.name) continue;
    const inner = await supabase.storage
      .from(VOICE_BUCKET)
      .list(`voice-responses/${dir.name}`, { limit: 1000 });
    if (inner.error) continue;
    for (const f of inner.data ?? []) {
      if (!f.name) continue;
      const path = `voice-responses/${dir.name}/${f.name}`;
      totalFilesInspected += 1;
      if (!referencedSet.has(path)) {
        orphans.push(path);
      }
    }
  }

  if (input.dry_run) {
    return NextResponse.json({
      dry_run: true,
      total_files_inspected: totalFilesInspected,
      referenced_count: referencedSet.size,
      orphan_count: orphans.length,
      orphan_paths: orphans.slice(0, 100),
      message:
        orphans.length === 0
          ? "No orphan files."
          : `Would delete ${orphans.length} orphan file(s). Re-run with dry_run=false to actually delete.`,
    });
  }

  // Bulk delete in batches of 100 (Supabase removeAll cap).
  let deleted = 0;
  const failures: string[] = [];
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100);
    const result = await supabase.storage.from(VOICE_BUCKET).remove(batch);
    if (result.error) {
      failures.push(result.error.message);
    } else {
      deleted += result.data?.length ?? batch.length;
    }
  }

  return NextResponse.json({
    dry_run: false,
    total_files_inspected: totalFilesInspected,
    orphan_count: orphans.length,
    deleted,
    failures,
  });
}
