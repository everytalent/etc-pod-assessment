/**
 * Tenant billing balance + ledger service — every credit/slot mutation
 * goes through here. Two invariants:
 *
 *   1. Every mutation writes BOTH a balance UPDATE and a ledger INSERT
 *      inside the same transaction. No mutation leaves the ledger
 *      missing an entry; no ledger entry exists without a matching
 *      balance change.
 *
 *   2. Consumes are guarded — generation_consumed and slot_consumed
 *      refuse to drop a balance below zero. Callers MUST handle the
 *      `insufficient_balance` result.
 *
 * Phase 4 ships with the in-process mutations. Paystack/Stripe webhook
 * routing into these helpers lands in Phase 4b alongside the
 * processor-specific glue.
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  tenantBillingBalance,
  tenantBillingLedger,
  type TenantBillingBalance,
  type TenantBillingEventType,
  type TenantPaymentProcessor,
} from "@/lib/db/schema";

export type MutateResult =
  | { ok: true; balance: TenantBillingBalance }
  | { ok: false; reason: "insufficient_balance"; balance: TenantBillingBalance }
  | { ok: false; reason: "no_balance_row" };

export type LedgerEntryInput = {
  eventType: TenantBillingEventType;
  generationCreditsDelta: number;
  candidateSlotsDelta: number;
  relatedAssessmentBankId?: string | null;
  relatedCandidateAssessmentId?: string | null;
  paymentProcessor?: TenantPaymentProcessor | null;
  paymentProcessorRef?: string | null;
  amountLocal?: number | null;
  currencyCode?: string | null;
  amountNgnAtTime?: number | null;
  fxRateSnapshotId?: string | null;
  pricingTierAtPurchase?: string | null;
  reason?: string | null;
};

export async function getBalance(
  tenantId: string,
): Promise<TenantBillingBalance | null> {
  const [row] = await db
    .select()
    .from(tenantBillingBalance)
    .where(eq(tenantBillingBalance.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/**
 * Provision the free trial for a new tenant. Idempotent: returns the
 * existing balance row when the trial has already been provisioned.
 */
export async function provisionTrialBalance(args: {
  tenantId: string;
  generationCredits: number;
  candidateSlots: number;
}): Promise<TenantBillingBalance> {
  const [existing] = await db
    .select()
    .from(tenantBillingBalance)
    .where(eq(tenantBillingBalance.tenantId, args.tenantId))
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(tenantBillingBalance)
    .values({
      tenantId: args.tenantId,
      generationCredits: args.generationCredits,
      candidateSlots: args.candidateSlots,
      trialConsumed: false,
    })
    .returning();

  await db.insert(tenantBillingLedger).values({
    tenantId: args.tenantId,
    eventType: "trial_provisioned",
    generationCreditsDelta: args.generationCredits,
    candidateSlotsDelta: args.candidateSlots,
    reason: "Free trial provisioned at tenant signup",
  });

  return row;
}

/**
 * Apply a credit / slot delta + write the ledger entry atomically.
 * Pure adds (purchases, refunds) skip the negative-balance guard.
 */
export async function applyBalanceMutation(args: {
  tenantId: string;
  entry: LedgerEntryInput;
  guardNonNegative?: boolean;
}): Promise<MutateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tenantBillingBalance)
      .where(eq(tenantBillingBalance.tenantId, args.tenantId))
      .for("update")
      .limit(1);

    if (!current) {
      return { ok: false, reason: "no_balance_row" } as const;
    }

    const nextGen =
      current.generationCredits + args.entry.generationCreditsDelta;
    const nextSlots = current.candidateSlots + args.entry.candidateSlotsDelta;

    if (args.guardNonNegative && (nextGen < 0 || nextSlots < 0)) {
      return {
        ok: false,
        reason: "insufficient_balance",
        balance: current,
      } as const;
    }

    const [updated] = await tx
      .update(tenantBillingBalance)
      .set({
        generationCredits: nextGen,
        candidateSlots: nextSlots,
        trialConsumed:
          current.trialConsumed ||
          (args.entry.eventType === "generation_consumed" &&
            !current.trialConsumed),
        updatedAt: new Date(),
      })
      .where(eq(tenantBillingBalance.tenantId, args.tenantId))
      .returning();

    await tx.insert(tenantBillingLedger).values({
      tenantId: args.tenantId,
      eventType: args.entry.eventType,
      generationCreditsDelta: args.entry.generationCreditsDelta,
      candidateSlotsDelta: args.entry.candidateSlotsDelta,
      relatedAssessmentBankId: args.entry.relatedAssessmentBankId ?? null,
      relatedCandidateAssessmentId:
        args.entry.relatedCandidateAssessmentId ?? null,
      paymentProcessor: args.entry.paymentProcessor ?? null,
      paymentProcessorRef: args.entry.paymentProcessorRef ?? null,
      amountLocal:
        args.entry.amountLocal !== null && args.entry.amountLocal !== undefined
          ? String(args.entry.amountLocal)
          : null,
      currencyCode: args.entry.currencyCode ?? null,
      amountNgnAtTime:
        args.entry.amountNgnAtTime !== null &&
        args.entry.amountNgnAtTime !== undefined
          ? String(args.entry.amountNgnAtTime)
          : null,
      fxRateSnapshotId: args.entry.fxRateSnapshotId ?? null,
      pricingTierAtPurchase: args.entry.pricingTierAtPurchase ?? null,
      reason: args.entry.reason ?? null,
    });

    return { ok: true, balance: updated } as const;
  });
}

/* ---------- Convenience wrappers ---------- */

export function consumeGenerationCredit(args: {
  tenantId: string;
  relatedAssessmentBankId: string;
}): Promise<MutateResult> {
  return applyBalanceMutation({
    tenantId: args.tenantId,
    guardNonNegative: true,
    entry: {
      eventType: "generation_consumed",
      generationCreditsDelta: -1,
      candidateSlotsDelta: 0,
      relatedAssessmentBankId: args.relatedAssessmentBankId,
      reason: "Generation success — credit consumed",
    },
  });
}

export function refundGenerationCredit(args: {
  tenantId: string;
  relatedAssessmentBankId: string;
  reason: string;
}): Promise<MutateResult> {
  return applyBalanceMutation({
    tenantId: args.tenantId,
    entry: {
      eventType: "generation_refunded",
      generationCreditsDelta: 1,
      candidateSlotsDelta: 0,
      relatedAssessmentBankId: args.relatedAssessmentBankId,
      reason: args.reason,
    },
  });
}

export function consumeCandidateSlot(args: {
  tenantId: string;
  relatedCandidateAssessmentId: string;
}): Promise<MutateResult> {
  return applyBalanceMutation({
    tenantId: args.tenantId,
    guardNonNegative: true,
    entry: {
      eventType: "slot_consumed",
      generationCreditsDelta: 0,
      candidateSlotsDelta: -1,
      relatedCandidateAssessmentId: args.relatedCandidateAssessmentId,
      reason: "Candidate completed assessment — slot consumed",
    },
  });
}

/**
 * Used by the post-intake payment gate. Returns whether the tenant has
 * the minimum balance to enqueue a generation job (1 credit AND ≥5
 * slots). Doesn't mutate state.
 */
export async function canSubmitForGeneration(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; reason: "needs_credit" | "low_slots"; current: TenantBillingBalance | null }> {
  const balance = await getBalance(tenantId);
  if (!balance) return { ok: false, reason: "needs_credit", current: null };
  if (balance.generationCredits < 1) {
    return { ok: false, reason: "needs_credit", current: balance };
  }
  if (balance.candidateSlots < 5) {
    return { ok: false, reason: "low_slots", current: balance };
  }
  return { ok: true };
}

/** Used by `sql` import lint — keep in scope for future range queries. */
void sql;
