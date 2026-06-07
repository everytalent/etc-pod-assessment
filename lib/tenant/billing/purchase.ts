/**
 * Purchase flow — Phase 4 ships a processor-agnostic shape with a
 * dev-mode "simulate success" path. Real Paystack + Stripe integration
 * lands in Phase 4b.
 *
 * The shape is intentional: every purchase API takes (tenantId, packId,
 * processorRef?) and the processor-specific glue is the only thing that
 * needs to change to flip from sim to live.
 *
 * Currency rules:
 *   - Nigeria → NGN via Paystack
 *   - International / US → USD-anchored via Stripe; local currency
 *     conversion happens at charge time
 *
 * Phase 4 records the catalog price as `amount_local` regardless of
 * processor — fine for ledger reporting. The FX-to-local mapping will
 * come in alongside the Stripe integration.
 */

import {
  type Tenant,
  type TenantPaymentProcessor,
} from "@/lib/db/schema";

import { applyBalanceMutation } from "./balance";
import {
  findPackById,
  findSubscriptionTierConfig,
  type Pack,
} from "./catalog";

export type PurchaseResult =
  | {
      ok: true;
      packLabel: string;
      generationCreditsDelta: number;
      candidateSlotsDelta: number;
      amount: number;
      currency: string;
    }
  | { ok: false; reason: string };

function processorFor(tenant: Tenant): TenantPaymentProcessor {
  return tenant.pricingTier === "nigeria" ? "paystack" : "stripe";
}

/**
 * Charge the tenant's card-on-file (or simulate in dev) and apply the
 * pack's deltas + write a ledger entry.
 *
 * `simulateSuccess` is for local dev — set TENANT_BILLING_SIMULATE=1 in
 * .env.local and the call returns ok without touching the processor.
 */
export async function purchasePack(args: {
  tenant: Tenant;
  packId: string;
  simulateSuccess?: boolean;
}): Promise<PurchaseResult> {
  const pack = findPackById(args.tenant.pricingTier, args.packId);
  if (!pack) return { ok: false, reason: "unknown_pack" };

  const processorRef = args.simulateSuccess
    ? `sim-${Date.now()}`
    : await chargeViaProcessor(args.tenant, pack);
  if (!processorRef) return { ok: false, reason: "payment_failed" };

  const result = await applyBalanceMutation({
    tenantId: args.tenant.id,
    entry: {
      eventType:
        pack.generationCreditsDelta > 0
          ? "generation_purchase"
          : "slot_purchase",
      generationCreditsDelta: pack.generationCreditsDelta,
      candidateSlotsDelta: pack.candidateSlotsDelta,
      paymentProcessor: processorFor(args.tenant),
      paymentProcessorRef: processorRef,
      amountLocal: pack.amount,
      currencyCode: pack.currency,
      pricingTierAtPurchase: "launch_promo",
      reason: pack.label,
    },
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return {
    ok: true,
    packLabel: pack.label,
    generationCreditsDelta: pack.generationCreditsDelta,
    candidateSlotsDelta: pack.candidateSlotsDelta,
    amount: pack.amount,
    currency: pack.currency,
  };
}

/**
 * Start a new subscription (charges + provisions immediately).
 * Cancelling existing-cycle handling is a Phase 4b refinement.
 */
export async function purchaseSubscription(args: {
  tenant: Tenant;
  tier: "starter" | "growth";
  simulateSuccess?: boolean;
}): Promise<PurchaseResult> {
  const cfg = findSubscriptionTierConfig(args.tenant.pricingTier, args.tier);
  if (!cfg) return { ok: false, reason: "unknown_tier" };

  const processorRef = args.simulateSuccess
    ? `sim-sub-${Date.now()}`
    : await chargeSubscriptionViaProcessor(args.tenant, cfg);
  if (!processorRef) return { ok: false, reason: "payment_failed" };

  const result = await applyBalanceMutation({
    tenantId: args.tenant.id,
    entry: {
      eventType: "subscription_renewed",
      generationCreditsDelta: cfg.generationCreditsPerCycle,
      candidateSlotsDelta: cfg.candidateSlotsPerCycle,
      paymentProcessor: processorFor(args.tenant),
      paymentProcessorRef: processorRef,
      amountLocal: cfg.monthlyAmount,
      currencyCode: cfg.currency,
      pricingTierAtPurchase: "launch_promo",
      reason: `Subscription renewal: ${cfg.label} (${args.tenant.pricingTier})`,
    },
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return {
    ok: true,
    packLabel: cfg.label,
    generationCreditsDelta: cfg.generationCreditsPerCycle,
    candidateSlotsDelta: cfg.candidateSlotsPerCycle,
    amount: cfg.monthlyAmount,
    currency: cfg.currency,
  };
}

/* ---------- Processor stubs ---------- */

async function chargeViaProcessor(
  tenant: Tenant,
  pack: Pack,
): Promise<string | null> {
  if (process.env.TENANT_BILLING_SIMULATE === "1") {
    return `sim-${pack.id}-${Date.now()}`;
  }
  // Phase 4b will replace these stubs with real Paystack/Stripe calls.
  console.warn(
    `[billing] processor stub: would charge ${tenant.pricingTier} tenant ${tenant.id} ${pack.amount} ${pack.currency} via ${processorFor(tenant)}`,
  );
  return null;
}

async function chargeSubscriptionViaProcessor(
  tenant: Tenant,
  cfg: { monthlyAmount: number; currency: string; label: string },
): Promise<string | null> {
  if (process.env.TENANT_BILLING_SIMULATE === "1") {
    return `sim-sub-${Date.now()}`;
  }
  console.warn(
    `[billing] processor stub: would subscribe ${tenant.pricingTier} tenant ${tenant.id} to ${cfg.label} at ${cfg.monthlyAmount} ${cfg.currency}`,
  );
  return null;
}
