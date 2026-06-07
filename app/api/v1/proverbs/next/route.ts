/**
 * GET /api/v1/proverbs/next?stage=X&seen=ID,ID,ID
 *
 * Returns one active proverb tagged for the requested stage and not in
 * the `seen` list. Falls back to any-stage when the requested stage's
 * pool is exhausted; falls back to repeats with a "wrap_around: true"
 * flag when the library is exhausted entirely.
 *
 * Open endpoint — no tenant auth. The wait page is brand-themed but
 * any browser holding the bank id can poll it; the proverb payload
 * itself is non-sensitive.
 */

import { and, eq, notInArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { proverb } from "@/lib/db/schema";
import { serialiseForTenant } from "@/lib/tenant/serialiser";

const VALID_STAGES = new Set([
  "reading_role",
  "calibrating",
  "crafting",
  "finalising",
]);

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const stage = url.searchParams.get("stage");
  const seenParam = url.searchParams.get("seen");
  const seen = seenParam
    ? seenParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    : [];

  if (!stage || !VALID_STAGES.has(stage)) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  // Prefer stage-tagged + unseen.
  const stageMatch = sql`${proverb.stages}::jsonb @> ${JSON.stringify([stage])}::jsonb`;

  const baseFilters = [eq(proverb.active, true)];
  if (seen.length > 0) {
    baseFilters.push(notInArray(proverb.id, seen));
  }

  let pick = await db
    .select()
    .from(proverb)
    .where(and(stageMatch, ...baseFilters))
    .orderBy(sql`random()`)
    .limit(1);

  let wrapAround = false;

  // Fall back to any-stage + unseen.
  if (pick.length === 0) {
    pick = await db
      .select()
      .from(proverb)
      .where(and(...baseFilters))
      .orderBy(sql`random()`)
      .limit(1);
  }

  // Library exhausted — allow a repeat.
  if (pick.length === 0) {
    wrapAround = true;
    pick = await db
      .select()
      .from(proverb)
      .where(eq(proverb.active, true))
      .orderBy(sql`random()`)
      .limit(1);
  }

  if (pick.length === 0) {
    return NextResponse.json({ error: "no_proverbs_seeded" }, { status: 503 });
  }

  const row = pick[0];
  return NextResponse.json(
    serialiseForTenant({
      id: row.id,
      language: row.language,
      original_text: row.originalText,
      transliteration: row.transliteration,
      english_translation: row.englishTranslation,
      contextual_note: row.contextualNote,
      source_attribution: row.sourceAttribution,
      wrap_around: wrapAround,
    }),
  );
  void or; // satisfy lint
}
