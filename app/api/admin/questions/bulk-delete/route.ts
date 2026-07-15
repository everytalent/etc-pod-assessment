/**
 * POST /api/admin/questions/bulk-delete
 *
 * Body: { question_ids: string[] }
 *
 * Removes a batch of questions. Answers referencing these questions
 * cascade-delete via the FK. Only editor+ can call.
 *
 * Prefer this over calling DELETE /questions/:id in a loop — the
 * batched delete is one round-trip and keeps the response table's
 * selection-mode UX consistent with responses/bulk-delete.
 */

import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { questions } from "@/lib/db/schema";

const inputSchema = z.object({
  question_ids: z.array(z.string().uuid()).min(1).max(500),
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
    .delete(questions)
    .where(inArray(questions.id, input.question_ids))
    .returning({ id: questions.id });

  return NextResponse.json({
    deleted_count: removed.length,
    deleted_ids: removed.map((r) => r.id),
  });
}
