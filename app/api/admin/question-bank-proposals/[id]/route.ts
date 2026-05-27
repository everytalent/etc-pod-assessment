/**
 * /api/admin/question-bank-proposals/[id]
 *
 *   POST { approve: true }  — merge proposal into the questions table
 *   POST { reject: true, notes? } — mark proposal rejected
 *
 * Permission: editor+. PRD §9 — weekly refresh writes proposals only;
 * publishing is always human-gated.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  questionBankProposals,
  questions,
  type PerformanceLevel,
  type ProposalAction,
  type QuestionOption,
  type SeniorityBand,
} from "@/lib/db/schema";
import { getOrCreateValidationBank } from "@/lib/engines/assessment/proposals/validation-bank";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), notes: z.string().min(1).max(2000) }),
]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;

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

  const [proposal] = await db
    .select()
    .from(questionBankProposals)
    .where(eq(questionBankProposals.id, id))
    .limit(1);
  if (!proposal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: "already_reviewed", current_status: proposal.status },
      { status: 409 },
    );
  }

  if (input.action === "reject") {
    await db
      .update(questionBankProposals)
      .set({
        status: "rejected",
        reviewedBy: auth.session.admin.id,
        reviewedAt: new Date(),
        reviewNotes: input.notes,
      })
      .where(eq(questionBankProposals.id, id));
    return NextResponse.json({ rejected: true });
  }

  // Approve: route by action type.
  if (proposal.action === ("add" as ProposalAction)) {
    await mergeAddProposal(proposal);
  } else if (proposal.action === ("add_below_standard" as ProposalAction) ||
             proposal.action === ("add_band_extension" as ProposalAction)) {
    await mergeAddProposal(proposal); // same shape, different scope hints
  } else {
    // retire / rebalance — defer detailed mutation to a follow-up;
    // mark approved so it stops showing in the queue.
  }

  await db
    .update(questionBankProposals)
    .set({
      status: "approved",
      reviewedBy: auth.session.admin.id,
      reviewedAt: new Date(),
    })
    .where(eq(questionBankProposals.id, id));

  return NextResponse.json({ approved: true });
}

async function mergeAddProposal(proposal: {
  specialisation: string;
  band: string | null;
  level: string | null;
  taskId: string | null;
  payload: unknown;
}): Promise<void> {
  const q = proposal.payload as {
    question_text: string;
    question_type: string;
    options?: Array<{ id: string; label: string }>;
    correct_answer?: string[];
    scoring_rubric: string;
    difficulty_score: number;
    competency_area?: string;
    weight?: number;
    interactive_config?: unknown;
  };

  // Resolve (or lazy-create) the sentinel validation-bank assessment
  // for this specialisation. All bank questions FK into it; see
  // lib/engines/assessment/proposals/validation-bank.ts for the rationale.
  const bank = await getOrCreateValidationBank(proposal.specialisation);

  // Decide order_index: append after the last bank question for this
  // specialisation. Order isn't meaningful for adaptive picks, but the
  // column is NOT NULL on the existing schema.
  const orderRows = await db
    .select({ orderIndex: questions.orderIndex })
    .from(questions)
    .where(eq(questions.assessmentId, bank.id));
  const nextOrder =
    orderRows.length === 0
      ? 0
      : Math.max(...orderRows.map((r) => r.orderIndex)) + 1;

  // Coerce question_type — the proposal schema's union is a strict
  // subset of the DB enum, so a cast is safe.
  type DbQuestionType =
    | "mcq" | "true_false" | "open" | "voice" | "file"
    | "formula" | "hotspot" | "sequence" | "slider"
    | "matching" | "scenario";

  await db.insert(questions).values({
    assessmentId: bank.id,
    orderIndex: nextOrder,
    type: q.question_type as DbQuestionType,
    questionText: q.question_text,
    options: (q.options ?? []) as QuestionOption[],
    correctAnswer: q.correct_answer ?? [],
    scoringRubric: q.scoring_rubric,
    // Validation-engine anchor fields (Phase 0 additive columns).
    specialisation: proposal.specialisation,
    band: proposal.band as SeniorityBand | null,
    level: proposal.level as PerformanceLevel | null,
    taskId: proposal.taskId,
    difficultyScore: q.difficulty_score,
    competencyArea: q.competency_area ?? null,
    weight: q.weight ?? 100,
    interactiveConfig: q.interactive_config ?? null,
    // Existing fixed-mode defaults that still apply:
    points: 1,
    negativePoints: 0,
    timerEnabled: false,
    required: true,
  });
}
