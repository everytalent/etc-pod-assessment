/**
 * Tenant builder worker — pulls one queued tenant_assessment_bank row
 * at a time and orchestrates the four-stage pipeline.
 *
 * Designed to share the Railway long-lived worker process with the
 * existing skillboard authoring worker (scripts/run-worker.mts). The
 * runner alternates: one skillboard tick, one tenant-bank tick.
 *
 * Concurrency: a single claim via UPDATE ... WHERE status='queued' ...
 * RETURNING grabs one row atomically. Stuck rows older than 10 min are
 * rescued back to 'queued' by the runner's periodic rescue.
 */

import { and, asc, eq, lt, or } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";

import { processOneTenantBank } from "./orchestrator";

/** Statuses that mean "actively being worked on" — used for rescue. */
const IN_FLIGHT_STATUSES = ["analysing", "calibrating", "crafting", "finalising"] as const;

export type TenantBankWorkerOutcome =
  | { processed: false; reason: "no_queued_rows" }
  | {
      processed: true;
      bankId: string;
      success: boolean;
      error?: string;
    };

export async function processOneTenantBankFromQueue(): Promise<TenantBankWorkerOutcome> {
  // Step 1: claim the oldest queued row by flipping it to 'analysing'.
  // We use an UPDATE...WHERE id IN (SELECT ... LIMIT 1) idiom via
  // a two-step: select the id, then update with status guard.
  const [candidate] = await db
    .select({ id: tenantAssessmentBank.id })
    .from(tenantAssessmentBank)
    .where(eq(tenantAssessmentBank.status, "queued"))
    .orderBy(asc(tenantAssessmentBank.createdAt))
    .limit(1);

  if (!candidate) {
    return { processed: false, reason: "no_queued_rows" };
  }

  const [claimed] = await db
    .update(tenantAssessmentBank)
    .set({ status: "analysing", updatedAt: new Date() })
    .where(
      and(
        eq(tenantAssessmentBank.id, candidate.id),
        eq(tenantAssessmentBank.status, "queued"),
      ),
    )
    .returning();

  if (!claimed) {
    // Another worker beat us to it.
    return { processed: false, reason: "no_queued_rows" };
  }

  const result = await processOneTenantBank(claimed);
  return {
    processed: true,
    bankId: claimed.id,
    success: result.ok,
    error: result.ok ? undefined : result.reason,
  };
}

/**
 * Rescue rows that have been stuck in an in-flight status for too long
 * (worker crashed mid-job). Called by the Railway runner on its
 * periodic rescue interval.
 */
export async function rescueStuckTenantBanks(
  stuckBeforeMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - stuckBeforeMs);
  const rescued = await db
    .update(tenantAssessmentBank)
    .set({ status: "queued", updatedAt: new Date() })
    .where(
      and(
        lt(tenantAssessmentBank.updatedAt, cutoff),
        or(
          ...IN_FLIGHT_STATUSES.map((s) => eq(tenantAssessmentBank.status, s)),
        )!,
      ),
    )
    .returning({ id: tenantAssessmentBank.id });
  return rescued.length;
}
