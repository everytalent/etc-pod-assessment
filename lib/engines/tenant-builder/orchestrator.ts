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
import { notify } from "@/lib/notify";
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
import { createProvisionalFramework } from "./provisional-author";

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

    // Stage 2: calibrating (match → provisional fallback).
    await setStatus(bank.id, "calibrating");
    const verdict = await matchToSkillboard(analysis);

    let resolvedSkillboardId: string;
    let resolvedSpecialisation: string;
    let routeTaken: "match" | "provisional";

    if (verdict.matched) {
      resolvedSkillboardId = verdict.skillboardId;
      resolvedSpecialisation = verdict.specialisation;
      routeTaken = "match";
      await db
        .update(tenantAssessmentBank)
        .set({
          routeTaken: "match",
          sourceSkillboardId: verdict.skillboardId,
        })
        .where(eq(tenantAssessmentBank.id, bank.id));
    } else {
      // Provisional path (PRD §2 "calibrating the framework" — internal
      // routing the tenant never sees).
      const provisional = await createProvisionalFramework({
        analysis,
        tenantId: bank.tenantId,
        derivedFromIds: verdict.candidates.map((c) => c.id).slice(0, 5),
      });
      resolvedSkillboardId = provisional.skillboardId;
      resolvedSpecialisation = provisional.specialisation;
      routeTaken = "provisional";
      await db
        .update(tenantAssessmentBank)
        .set({
          routeTaken: "provisional",
          provisionalFrameworkId: provisional.skillboardId,
        })
        .where(eq(tenantAssessmentBank.id, bank.id));
    }

    void routeTaken; // logged for completeness; internal-only field

    // Stage 3: crafting.
    await setStatus(bank.id, "crafting");
    const build = await buildAssessmentBankForSkillboard({
      skillboardId: resolvedSkillboardId,
      tenantBankId: bank.id,
      specialisation: resolvedSpecialisation,
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

    // Email the tenant that their assessment is ready (PRD §3).
    try {
      await notify({
        severity: "info",
        eventType: "tenant_assessment_ready",
        payload: {
          tenant_id: bank.tenantId,
          bank_id: bank.id,
          assessment_link_token: build.slug,
          generated_count: build.generatedCount,
          tenant_authored_count: build.tenantAuthoredCount,
        },
      });
    } catch {
      // Don't fail the build if notify is misconfigured.
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

    try {
      await notify({
        severity: "warn",
        eventType: "tenant_assessment_failed",
        payload: {
          tenant_id: bank.tenantId,
          bank_id: bank.id,
          reason: message,
        },
      });
    } catch {
      // Don't double-fail on notify misconfig.
    }
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
