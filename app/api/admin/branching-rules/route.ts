/**
 * POST /api/admin/branching-rules — create a rule, with cycle detection.
 *
 * Cycle check: load all questions + existing rules for the assessment, add
 * the proposed rule, run engine.detectCycles(); reject (400) if any cycle
 * surfaces. Mitigates PRD §9 risk: "Admin builds invalid branching (cycle)".
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { upsertBranchingRuleSchema } from "@/lib/admin/validators";
import { detectCycles } from "@/lib/assessment/engine";
import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { branchingRules, questions } from "@/lib/db/schema";

export async function POST(req: Request) {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  let input;
  try {
    const body = await req.json().catch(() => ({}));
    input = upsertBranchingRuleSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [allQuestions, existingRules] = await Promise.all([
    db
      .select({
        id: questions.id,
        orderIndex: questions.orderIndex,
        section: questions.section,
      })
      .from(questions)
      .where(eq(questions.assessmentId, input.assessmentId)),
    db
      .select({
        fromQuestionId: branchingRules.fromQuestionId,
        action: branchingRules.action,
      })
      .from(branchingRules)
      .where(eq(branchingRules.assessmentId, input.assessmentId)),
  ]);

  const proposed = [
    ...existingRules,
    { fromQuestionId: input.fromQuestionId, action: input.action },
  ];
  const cycles = detectCycles(allQuestions, proposed);
  if (cycles.length > 0) {
    return NextResponse.json(
      { error: "cycle_detected", cycles },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(branchingRules)
    .values({
      assessmentId: input.assessmentId,
      fromQuestionId: input.fromQuestionId,
      condition: input.condition,
      action: input.action,
      priority: input.priority,
    })
    .returning();

  return NextResponse.json({ rule: created }, { status: 201 });
}
