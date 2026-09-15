/**
 * POST /api/admin/skillboards/[id]/activate
 *
 * Sets `activated_at = now()` after verifying every level_expectations
 * cell is `approved`. PRD §1b — partial approval is not enough.
 *
 * v1.1 (2026-06-18): On activation, also enqueue a `question_seed` job
 * for every (band × level × task) cell on the board. Each job runs
 * Opus to generate ~3 candidate questions for the cell and (per the
 * existing worker's auto_approve default) inserts them straight into
 * the validation bank assessment — no human re-approval needed.
 *
 * Without this, activated skillboards had ZERO questions in their
 * validation bank, which sent every candidate straight to the
 * "Submitted" screen after Onboarding handed them off.
 *
 * Permission: Learning Expert (editor+ with can_approve_skillboards).
 */

import { NextResponse } from "next/server";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import {
  checkActivationReadiness,
  markActivated,
} from "@/lib/engines/assessment/skillboards/activator";
import { enqueueBankSeedJobs } from "@/lib/engines/assessment/skillboards/bank-seed-enqueue";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id } = await context.params;
  const check = await checkActivationReadiness(id);
  if (!check.ready) {
    return NextResponse.json(
      {
        error: "not_ready_for_activation",
        ...check,
      },
      { status: 422 },
    );
  }

  await markActivated(id);

  // Enqueue auto-seed jobs — one per (band × level × task) cell.
  // The worker picks them up on its next poll (or the Netlify cron
  // tick) and runs them in parallel up to the worker concurrency cap.
  // Each job auto-approves its output into the validation bank.
  //
  // Shared with the automatic provisioning path so a board authored
  // because a candidate turned up with an unknown specialisation gets
  // exactly the same bank an admin activation would have produced.
  const enqueued = await enqueueBankSeedJobs(id);

  return NextResponse.json({
    activated: true,
    seed_jobs_enqueued: enqueued,
    estimated_cost_usd: Number((enqueued * 0.05).toFixed(2)),
  });
}
