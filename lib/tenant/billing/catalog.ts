/**
 * Pricing catalog — single source of truth for what a tenant pays.
 *
 * PRD §1a "Scope" + §7. Tier follows the tenant's locked country
 * (Nigeria | International | US). Currency follows country (NGN, GBP,
 * CAD, USD, AED).
 *
 * All v1 prices are launch-promo prices. The cutover to standard
 * pricing is a single config flip (system_config.pricing_tier =
 * 'launch_promo' | 'standard'). Standard pricing isn't authored here
 * yet — it's set during the launch-end review (PRD §7a). Until that
 * lands, both legs of the if/else point at the same catalog.
 */

import type { TenantPricingTier } from "@/lib/db/schema";

export type Currency = "NGN" | "GBP" | "CAD" | "AED" | "USD";

export type Pack = {
  /** Stable id surfaced in the API; also used as ledger reason text. */
  id: string;
  /** Human label for the UI. */
  label: string;
  /** Generation credits added by this purchase. */
  generationCreditsDelta: number;
  /** Candidate slots added by this purchase. */
  candidateSlotsDelta: number;
  /** Price in the tenant's currency. */
  amount: number;
  currency: Currency;
};

export type SubscriptionTierConfig = {
  id: "starter" | "growth";
  label: string;
  monthlyAmount: number;
  currency: Currency;
  generationCreditsPerCycle: number;
  candidateSlotsPerCycle: number;
};

export type TrialAllocation = {
  generationCredits: number;
  candidateSlots: number;
};

export type PricingCatalog = {
  currency: Currency;
  trial: TrialAllocation;
  payAsYouGo: Pack;
  slotTopUps: Pack[];
  subscriptions: SubscriptionTierConfig[];
  footerRemoval: {
    annual: { amount: number; currency: Currency };
    perpetual: { amount: number; currency: Currency };
  };
};

const NIGERIA: PricingCatalog = {
  currency: "NGN",
  trial: { generationCredits: 1, candidateSlots: 10 },
  payAsYouGo: {
    id: "ng_payg_entry",
    label: "Pay-as-you-go (1 assessment + 10 slots)",
    generationCreditsDelta: 1,
    candidateSlotsDelta: 10,
    amount: 30_000,
    currency: "NGN",
  },
  slotTopUps: [
    {
      id: "ng_slot_30",
      label: "30 slots",
      generationCreditsDelta: 0,
      candidateSlotsDelta: 30,
      amount: 50_000,
      currency: "NGN",
    },
    {
      id: "ng_slot_100",
      label: "100 slots (max standalone)",
      generationCreditsDelta: 0,
      candidateSlotsDelta: 100,
      amount: 150_000,
      currency: "NGN",
    },
  ],
  subscriptions: [
    {
      id: "starter",
      label: "Starter",
      monthlyAmount: 278_000,
      currency: "NGN",
      generationCreditsPerCycle: 2,
      candidateSlotsPerCycle: 200,
    },
    {
      id: "growth",
      label: "Growth",
      monthlyAmount: 395_000,
      currency: "NGN",
      generationCreditsPerCycle: 3,
      candidateSlotsPerCycle: 300,
    },
  ],
  footerRemoval: {
    annual: { amount: 2_500_000, currency: "NGN" },
    perpetual: { amount: 5_000_000, currency: "NGN" },
  },
};

/** International base (UK/CA/AE/XK). USD-anchored, billed in local currency. */
const INTERNATIONAL: PricingCatalog = {
  currency: "USD",
  trial: { generationCredits: 1, candidateSlots: 3 },
  payAsYouGo: {
    id: "intl_payg_entry",
    label: "Pay-as-you-go (1 assessment + 10 slots)",
    generationCreditsDelta: 1,
    candidateSlotsDelta: 10,
    amount: 60,
    currency: "USD",
  },
  slotTopUps: [
    {
      id: "intl_slot_100",
      label: "100 slots (max standalone)",
      generationCreditsDelta: 0,
      candidateSlotsDelta: 100,
      amount: 250,
      currency: "USD",
    },
  ],
  subscriptions: [
    {
      id: "starter",
      label: "Starter",
      monthlyAmount: 330,
      currency: "USD",
      generationCreditsPerCycle: 1,
      candidateSlotsPerCycle: 120,
    },
    {
      id: "growth",
      label: "Growth",
      monthlyAmount: 880,
      currency: "USD",
      generationCreditsPerCycle: 3,
      candidateSlotsPerCycle: 400,
    },
  ],
  footerRemoval: {
    annual: { amount: 7_500, currency: "USD" },
    perpetual: { amount: 15_000, currency: "USD" },
  },
};

const US: PricingCatalog = {
  currency: "USD",
  trial: { generationCredits: 1, candidateSlots: 3 },
  payAsYouGo: {
    id: "us_payg_entry",
    label: "Pay-as-you-go (1 assessment + 10 slots)",
    generationCreditsDelta: 1,
    candidateSlotsDelta: 10,
    amount: 69,
    currency: "USD",
  },
  slotTopUps: [
    {
      id: "us_slot_100",
      label: "100 slots (max standalone)",
      generationCreditsDelta: 0,
      candidateSlotsDelta: 100,
      amount: 287.5,
      currency: "USD",
    },
  ],
  subscriptions: [
    {
      id: "starter",
      label: "Starter",
      monthlyAmount: 380,
      currency: "USD",
      generationCreditsPerCycle: 1,
      candidateSlotsPerCycle: 120,
    },
    {
      id: "growth",
      label: "Growth",
      monthlyAmount: 1_015,
      currency: "USD",
      generationCreditsPerCycle: 3,
      candidateSlotsPerCycle: 400,
    },
  ],
  footerRemoval: {
    annual: { amount: 8_625, currency: "USD" },
    perpetual: { amount: 17_250, currency: "USD" },
  },
};

const CATALOG: Record<TenantPricingTier, PricingCatalog> = {
  nigeria: NIGERIA,
  international: INTERNATIONAL,
  us: US,
};

export function getCatalog(tier: TenantPricingTier): PricingCatalog {
  return CATALOG[tier];
}

/**
 * Currency override for international-tier tenants. The PRD prices the
 * International tier in USD; the tenant is charged in their LOCAL
 * currency at the FX rate of the day (locked to the purchase). For
 * Phase 4 we display the catalog price in USD; FX conversion to GBP /
 * CAD / AED happens at purchase time via lib/tenant/billing/fx.ts.
 */
export function displayCurrencyForTenant(args: {
  pricingTier: TenantPricingTier;
  tenantCurrency: string;
}): Currency {
  if (args.pricingTier === "nigeria") return "NGN";
  // International / US tiers: prices are USD-anchored. The UI tells
  // the tenant "$60 USD = approx £48 GBP" via the FX helper.
  return "USD";
}

/**
 * All packs available to a tier in one list — used by the TopUpDialog
 * to render every purchasable option without the UI having to know the
 * tier-specific shape.
 */
export function allPurchasablePacksForTier(tier: TenantPricingTier): Pack[] {
  const cat = CATALOG[tier];
  return [cat.payAsYouGo, ...cat.slotTopUps];
}

export function findPackById(
  tier: TenantPricingTier,
  packId: string,
): Pack | null {
  const cat = CATALOG[tier];
  if (cat.payAsYouGo.id === packId) return cat.payAsYouGo;
  return cat.slotTopUps.find((p) => p.id === packId) ?? null;
}

export function findSubscriptionTierConfig(
  tier: TenantPricingTier,
  sub: "starter" | "growth",
): SubscriptionTierConfig | null {
  return CATALOG[tier].subscriptions.find((s) => s.id === sub) ?? null;
}
