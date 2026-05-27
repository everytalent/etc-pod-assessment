/**
 * AI model pricing constants — single source of truth for cost computation
 * across every spend-ledger write.
 *
 * Values are in USD per 1M tokens. Update when providers change prices;
 * the ledger records the cost at call time using these constants so a
 * pricing shift doesn't retroactively rewrite history.
 *
 * Sources:
 *   - Claude Opus 4.x: anthropic.com/pricing
 *   - Gemini 2.5: ai.google.dev/pricing
 *   - Moonshot Kimi: api.moonshot.ai/v1/pricing
 *
 * Last reviewed: 2026-05-19
 */

import type { AiSpendModel } from "@/lib/db/schema";

export type ModelPricing = {
  inputPerMTokensUsd: number;
  outputPerMTokensUsd: number;
};

export const MODEL_PRICING: Record<AiSpendModel, ModelPricing> = {
  // Claude Opus 4.x. Input + cache-read pricing; we don't yet track
  // cache-write or cache-read separately — assumed worst case.
  opus: { inputPerMTokensUsd: 15, outputPerMTokensUsd: 75 },
  // Gemini 2.5 Pro — used for scoring rubrics.
  gemini_pro: { inputPerMTokensUsd: 1.25, outputPerMTokensUsd: 10 },
  // Gemini 2.5 Flash — used for transcription + translation.
  gemini_flash: { inputPerMTokensUsd: 0.3, outputPerMTokensUsd: 2.5 },
  // Moonshot Kimi (moonshot-v1-8k).
  kimi: { inputPerMTokensUsd: 0.6, outputPerMTokensUsd: 0.6 },
};

/**
 * Compute cost in USD x10000 (4 decimal places stored as int) given
 * input + output token counts. Storing as int avoids float drift in
 * monthly aggregations.
 */
export function costUsdX10000(
  model: AiSpendModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING[model];
  const inputUsd = (inputTokens / 1_000_000) * p.inputPerMTokensUsd;
  const outputUsd = (outputTokens / 1_000_000) * p.outputPerMTokensUsd;
  const usd = inputUsd + outputUsd;
  return Math.round(usd * 10_000);
}

/** Convenience: x10000-int back to a display USD string. */
export function formatCostUsd(costUsdX10000: number): string {
  const usd = costUsdX10000 / 10_000;
  return `$${usd.toFixed(4)}`;
}
