/**
 * POST /api/admin/questions/reorder — bulk reorder questions inside an
 * assessment. Accepts the new ordered array of question ids and rewrites
 * `order_index` accordingly. Atomic via Drizzle transaction.
 */

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { questions } from "@/lib/db/schema";
import { reorderQuestionsSchema } from "@/lib/admin/validators";

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = reorderQuestionsSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Sanity: all referenced questions must belong to this assessment.
  const owned = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      and(
        eq(questions.assessmentId, input.assessmentId),
        inArray(questions.id, input.orderedIds),
      ),
    );
  if (owned.length !== input.orderedIds.length) {
    return NextResponse.json(
      { error: "ids_do_not_match_assessment" },
      { status: 400 },
    );
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.orderedIds.length; i++) {
      await tx
        .update(questions)
        .set({ orderIndex: i })
        .where(eq(questions.id, input.orderedIds[i]!));
    }
  });

  return NextResponse.json({ ok: true, count: input.orderedIds.length });
}
