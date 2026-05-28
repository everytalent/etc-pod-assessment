/**
 * POST /api/admin/skillboards/[id]/test-seed
 *
 * Superadmin-only TEST helper: runs Opus seed for N cells of this
 * skillboard, then auto-approves every resulting proposal so the
 * Validation Bank has questions immediately.
 *
 * Designed for the "one-click end-to-end demo" — used when you want
 * to take a real candidate through validation without manually
 * approving each Opus-generated question.
 *
 * Body (all optional):
 *   { max_cells?: number, only_band?, only_level? }
 *
 * Cost guard: max_cells default 1, hard cap 5 to prevent test-button
 * misclicks from burning the Opus budget. Production seeding should
 * use /api/admin/jobs/opus-seed (no auto-approve).
 */

import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSuperAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  questionBankProposals,
  questions,
  skillboards,
  skills,
  tasks,
  type PerformanceLevel,
  type ProposalAction,
  type QuestionOption,
  type SeniorityBand,
} from "@/lib/db/schema";
import { seedQuestionsForCell } from "@/lib/engines/assessment/proposals/opus-seed";
import { getOrCreateValidationBank } from "@/lib/engines/assessment/proposals/validation-bank";

const inputSchema = z.object({
  max_cells: z.number().int().min(1).max(5).default(1),
  only_band: z.enum(["junior", "mid", "senior"]).optional(),
  only_level: z.enum(["below", "nh", "g", "p", "tp"]).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSuperAdminApi();
  if (!auth.user) return auth.unauthorized;

  const { id: skillboardId } = await context.params;

  let input;
  try {
    input = inputSchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Confirm skillboard exists + activated
  const [board] = await db
    .select({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
      activatedAt: skillboards.activatedAt,
    })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!board) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!board.activatedAt) {
    return NextResponse.json(
      { error: "skillboard_not_active", message: "Activate the board first." },
      { status: 422 },
    );
  }

  // Pick (band, level, task) targets — same selection logic as
  // /api/admin/jobs/opus-seed but capped at max_cells.
  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, board.id));
  if (taskRows.length === 0) {
    return NextResponse.json({ error: "no_tasks_on_skillboard" }, { status: 422 });
  }
  const bands: SeniorityBand[] = input.only_band
    ? [input.only_band]
    : ["junior", "mid", "senior"];
  const levels: PerformanceLevel[] = input.only_level
    ? [input.only_level]
    : ["g"]; // default to 'Growing' for tests — middle of the band
  const targets: {
    band: SeniorityBand;
    level: PerformanceLevel;
    taskId: string;
  }[] = [];
  for (const t of taskRows) {
    for (const b of bands) {
      for (const l of levels) {
        targets.push({ band: b, level: l, taskId: t.id });
      }
    }
  }
  const capped = targets.slice(0, input.max_cells);

  // Snapshot the highest proposal id at start so we can find ONLY
  // proposals created by this seed run.
  const [latestBefore] = await db
    .select({ id: questionBankProposals.id })
    .from(questionBankProposals)
    .orderBy(questionBankProposals.proposedAt)
    .limit(1);

  const seedStart = new Date();
  let totalEnqueued = 0;
  const failures: { error: string }[] = [];

  for (const t of capped) {
    try {
      const r = await seedQuestionsForCell({
        specialisation: board.specialisation,
        band: t.band,
        level: t.level,
        taskId: t.taskId,
      });
      totalEnqueued += r.enqueued;
    } catch (err) {
      failures.push({
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  // Auto-approve proposals that landed during this seed run.
  // We match by specialisation + proposedAt >= seedStart.
  const fresh = await db
    .select()
    .from(questionBankProposals)
    .where(
      and(
        eq(questionBankProposals.specialisation, board.specialisation),
        eq(questionBankProposals.status, "pending"),
        gt(questionBankProposals.proposedAt, seedStart),
      ),
    );

  let approved = 0;
  for (const p of fresh) {
    try {
      if (
        p.action === ("add" as ProposalAction) ||
        p.action === ("add_below_standard" as ProposalAction) ||
        p.action === ("add_band_extension" as ProposalAction)
      ) {
        await mergeAddProposal(p);
      }
      await db
        .update(questionBankProposals)
        .set({
          status: "approved",
          reviewedBy: auth.session.admin.id,
          reviewedAt: new Date(),
          reviewNotes: "auto-approved via test-seed",
        })
        .where(eq(questionBankProposals.id, p.id));
      approved += 1;
    } catch (err) {
      failures.push({ error: err instanceof Error ? err.message : "merge failed" });
    }
  }

  // Pre-empt "unused import" warning for latestBefore
  void latestBefore;

  return NextResponse.json({
    cells_seeded: capped.length,
    proposals_enqueued: totalEnqueued,
    proposals_auto_approved: approved,
    failures,
  });
}

/** Same logic as /api/admin/question-bank-proposals/[id] approve path. */
async function mergeAddProposal(p: {
  specialisation: string;
  band: string | null;
  level: string | null;
  taskId: string | null;
  payload: unknown;
}): Promise<void> {
  const q = p.payload as {
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
  const bank = await getOrCreateValidationBank(p.specialisation);
  const orderRows = await db
    .select({ orderIndex: questions.orderIndex })
    .from(questions)
    .where(eq(questions.assessmentId, bank.id));
  const nextOrder =
    orderRows.length === 0
      ? 0
      : Math.max(...orderRows.map((r) => r.orderIndex)) + 1;

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
    specialisation: p.specialisation,
    band: p.band as SeniorityBand | null,
    level: p.level as PerformanceLevel | null,
    taskId: p.taskId,
    difficultyScore: q.difficulty_score,
    competencyArea: q.competency_area ?? null,
    weight: q.weight ?? 100,
    interactiveConfig: q.interactive_config ?? null,
    points: 1,
    negativePoints: 0,
    timerEnabled: false,
    required: true,
  });
}
