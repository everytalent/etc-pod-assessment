/**
 * Country → currency → pricing-tier mapping for tenant signup.
 *
 * The country is auto-detected at signup (IP + Stripe/Paystack KYC) and
 * locked thereafter; moving country = new account. Currency and tier
 * derive from the country via this module, so callers never pass a
 * tier/currency directly — they pass a country and read the rest back.
 *
 * Six markets supported at launch (PRD §1a):
 *   NG → NGN, Nigeria tier
 *   UK → GBP, International tier
 *   CA → CAD, International tier
 *   AE → AED, International tier
 *   XK → USD, International tier  (Caribbean — internal sentinel, no ISO code)
 *   US → USD, International tier + 15% surcharge
 *
 * Anything else is rejected by `resolveTenantCountry()` so we don't
 * silently default to the wrong tier for an unsupported market.
 */

import type { TenantPricingTier } from "@/lib/db/schema";

export type SupportedCountryCode = "NG" | "UK" | "CA" | "AE" | "XK" | "US";

export type TenantCountryResolution = {
  countryCode: SupportedCountryCode;
  currencyCode: "NGN" | "GBP" | "CAD" | "AED" | "USD";
  pricingTier: TenantPricingTier;
};

const COUNTRY_MAP: Record<SupportedCountryCode, TenantCountryResolution> = {
  NG: { countryCode: "NG", currencyCode: "NGN", pricingTier: "nigeria" },
  UK: { countryCode: "UK", currencyCode: "GBP", pricingTier: "international" },
  CA: { countryCode: "CA", currencyCode: "CAD", pricingTier: "international" },
  AE: { countryCode: "AE", currencyCode: "AED", pricingTier: "international" },
  XK: { countryCode: "XK", currencyCode: "USD", pricingTier: "international" },
  US: { countryCode: "US", currencyCode: "USD", pricingTier: "us" },
};

export function resolveTenantCountry(
  raw: string | null | undefined,
): TenantCountryResolution | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  // Tolerate ISO 3166-1 alpha-2 for the UK ("GB") since IP geo APIs
  // tend to emit GB rather than UK; map it through.
  const code = upper === "GB" ? "UK" : upper;
  return COUNTRY_MAP[code as SupportedCountryCode] ?? null;
}

export function isSupportedTenantCountry(
  raw: string | null | undefined,
): raw is SupportedCountryCode {
  return resolveTenantCountry(raw) !== null;
}
