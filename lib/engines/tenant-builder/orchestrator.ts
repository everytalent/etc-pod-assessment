/**
 * Tenant builder orchestrator — runs the four-stage pipeline for one
 * queued tenant_assessment_bank row.
 *
 * Stages (PRD §2):
 *   1. analysing      — extract structured intake snapshot
 *   2. calibrating    — match to existing skillboard (or fail; Phase 2c
 *                       wires the provisional path)
 *   3. crafting       — generate questions across the grid + merge
 *                       tenant-supplied questions
 *   4. finalising     — stratify sample preview + mint link
 *
 * Status transitions are persisted as each stage starts so the polling
 * client sees forward motion (and the Proverb Engine in Phase 3 can
 * swap stage labels in real time).
 *
 * Failure handling: any throw marks the row 'failed' with the error
 * message in failure_reason and persists. Phase 4 (billing) will hook
 * the credit-refund path here.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  tenantAssessmentBank,
  type TenantAssessmentBank,
} from "@/lib/db/schema";
import {
  consumeGenerationCredit,
  refundGenerationCredit,
} from "@/lib/tenant/billing/balance";

import {
  buildAssessmentBankForSkillboard,
  stratifySamplePreview,
} from "./bank-builder";
import { analyseIntake } from "./intake-analyser";
import { matchToSkillboard } from "./matcher";

const LINK_TTL_DAYS = 30;

export async function processOneTenantBank(
  bank: TenantAssessmentBank,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const t0 = Date.now();
  try {
    // Stage 1: analysing.
    await setStatus(bank.id, "analysing");
    const analysis = await analyseIntake({
      intakeType: bank.intakeType,
      intakeText: bank.intakeText,
      contextText: bank.contextText,
    });

    // Stage 2: calibrating (match).
    await setStatus(bank.id, "calibrating");
    const verdict = await matchToSkillboard(analysis);
    if (!verdict.matched) {
      // Phase 2c will create a provisional framework here. For Phase 2b
      // we surface a clear failure so admins know what to seed manually.
      throw new Error(
        `No matching skillboard for "${analysis.specialisation_guess}" (best confidence ${verdict.confidence.toFixed(2)}). ${verdict.reasoning}`,
      );
    }

    await db
      .update(tenantAssessmentBank)
      .set({
        routeTaken: "match",
        sourceSkillboardId: verdict.skillboardId,
      })
      .where(eq(tenantAssessmentBank.id, bank.id));

    // Stage 3: crafting.
    await setStatus(bank.id, "crafting");
    const build = await buildAssessmentBankForSkillboard({
      skillboardId: verdict.skillboardId,
      tenantBankId: bank.id,
      specialisation: verdict.specialisation,
      tenantSuppliedQuestions: bank.tenantSuppliedQuestions,
    });

    // Stage 4: finalising.
    await setStatus(bank.id, "finalising");
    const samplePreviewIds = await stratifySamplePreview(build.assessmentId);

    const linkExpiresAt = new Date();
    linkExpiresAt.setDate(linkExpiresAt.getDate() + LINK_TTL_DAYS);

    await db
      .update(tenantAssessmentBank)
      .set({
        status: "ready",
        assessmentLinkToken: build.slug,
        linkExpiresAt,
        samplePreviewQuestionIds: samplePreviewIds,
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(tenantAssessmentBank.id, bank.id));

    // Consume the generation credit only on success (PRD §7).
    const consume = await consumeGenerationCredit({
      tenantId: bank.tenantId,
      relatedAssessmentBankId: bank.id,
    });
    if (!consume.ok) {
      console.warn(
        `[tenant-builder] credit-consume after success failed: tenant=${bank.tenantId} reason=${consume.reason}`,
      );
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await db
      .update(tenantAssessmentBank)
      .set({
        status: "failed",
        routeTaken: "failed",
        failureReason: message,
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(tenantAssessmentBank.id, bank.id));

    // Refund (no-op if no consume happened earlier — Phase 4 consumes
    // post-success, so failed banks don't need a refund. Kept as a
    // safety net in case the policy changes back to consume-on-claim).
    void refundGenerationCredit;
    return { ok: false, reason: message };
  }
}

async function setStatus(
  id: string,
  status:
    | "analysing"
    | "calibrating"
    | "crafting"
    | "finalising",
): Promise<void> {
  await db
    .update(tenantAssessmentBank)
    .set({ status, updatedAt: new Date() })
    .where(eq(tenantAssessmentBank.id, id));
}
