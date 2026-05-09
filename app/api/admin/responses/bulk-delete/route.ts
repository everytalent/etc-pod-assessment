/**
 * POST /api/admin/responses/bulk-delete
 *
 * Body: { response_ids: string[] }
 *
 * Atomically removes a batch of responses (cascade clears their answers).
 * Used by the response table's selection mode in the admin UI.
 *
 * Permission: editor or above.
 */

import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { responses } from "@/lib/db/schema";

const inputSchema = z.object({
  response_ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(req: Request) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const removed = await db
    .delete(responses)
    .where(inArray(responses.id, input.response_ids))
    .returning({ id: responses.id });

  return NextResponse.json({
    deleted_count: removed.length,
    deleted_ids: removed.map((r) => r.id),
  });
}
