/**
 * POST /api/sessions/signal
 *
 * Increments soft anti-cheating counters on the candidate's response
 * metadata. Called by the client when the page loses visibility
 * (tab/app switch) or when paste fires on an open-ended answer.
 *
 * Fire-and-forget: client never blocks on the response. We swallow
 * unknown signals silently (forward compatibility with new signal
 * types added later).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import {
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";

const inputSchema = z.object({
  type: z.enum(["tab_blur", "paste"]),
});

export async function POST(req: Request) {
  const responseId = await getCandidateSession();
  if (!responseId) {
    // Silent — the candidate may have already submitted. No state change.
    return NextResponse.json({ ok: true });
  }

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const [row] = await db
    .select({ metadata: responses.metadata })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!row) return NextResponse.json({ ok: true });

  const meta = (row.metadata ?? {}) as ResponseMetadata;
  const next: ResponseMetadata = {
    ...meta,
    ...(input.type === "tab_blur"
      ? { tab_blur_count: (meta.tab_blur_count ?? 0) + 1 }
      : { paste_count: (meta.paste_count ?? 0) + 1 }),
  };

  await db
    .update(responses)
    .set({ metadata: next })
    .where(eq(responses.id, responseId));

  return NextResponse.json({ ok: true });
}
