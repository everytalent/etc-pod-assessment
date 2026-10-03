/**
 * Claude Opus client wrapper + budget gate.
 *
 * Every Opus call must go through `withOpusBudget()`. It:
 *   1. Reads the current month's spend from `ai_spend_ledger`.
 *   2. Refuses if we're at the cap (notify('critical')).
 *   3. Calls the model.
 *   4. Writes a ledger row with token counts + computed cost.
 *   5. Fires notify('warn') if we just crossed the 80% threshold.
 *
 * Cap: $130/month (PRD §13). Threshold: $104 (80%). Both tunable via
 * env vars in case Anthropic pricing shifts before we ship a settings UI.
 *
 * Why Opus and not Gemini/Kimi: Opus is reserved for skillboard
 * authoring, question seeding, learning-summary synthesis, and
 * one-shot regenerations — the high-stakes generation tasks where
 * quality matters more than cost. Gemini/Kimi handle the per-answer
 * scoring volume where cheaper-and-fast wins.
 */

import { and, eq, gte, sum } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { aiSpendLedger, type AiSpendPurpose } from "@/lib/db/schema";
import { notify } from "@/lib/notify";
import { asciiSafeJsonStringify } from "@/lib/tenant/sanitise";

import { costUsdX10000 } from "./pricing";

const OPUS_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPUS_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

/**
 * When Anthropic cannot answer because the account is out of credit (or
 * no key is configured), the same call runs on Gemini instead. Assessment
 * creation, skillboard authoring and the rest keep working on the other
 * key rather than queueing behind a billing top-up. The first refusal
 * starts a cooldown so later calls go straight to Gemini instead of
 * paying a failed Anthropic round trip each time.
 */
const GEMINI_FALLBACK_CANDIDATES = [
  "gemini-3.1-pro-preview",
  "gemini-pro-latest",
  "gemini-2.5-pro",
] as const;
const CREDIT_COOLDOWN_MS = 15 * 60 * 1000;
let anthropicOutOfCreditAt: number | null = null;
let resolvedGeminiModel: string | null = null;

function anthropicKnownOutOfCredit(): boolean {
  return anthropicOutOfCreditAt !== null && Date.now() - anthropicOutOfCreditAt < CREDIT_COOLDOWN_MS;
}

/** Which provider will answer the next call, for status surfaces. */
export function authoringProvider(): "anthropic" | "gemini" | "none" {
  if (process.env.ANTHROPIC_API_KEY && !anthropicKnownOutOfCredit()) return "anthropic";
  if (process.env.ASSESSMENT_GEMINI_KEY) return "gemini";
  return "none";
}

const MONTHLY_CAP_USD = Number(process.env.OPUS_MONTHLY_CAP_USD ?? "130");
const WARN_THRESHOLD_USD = Number(
  process.env.OPUS_WARN_THRESHOLD_USD ?? "104",
);

export class OpusBudgetExceededError extends Error {
  constructor(public readonly monthlySpentUsd: number) {
    super(
      `Opus monthly cap reached: $${monthlySpentUsd.toFixed(2)} of $${MONTHLY_CAP_USD}`,
    );
    this.name = "OpusBudgetExceededError";
  }
}

/* ---------- Public API ---------- */

export type OpusCallArgs = {
  /** Prompt + behaviour wrapped per Anthropic Messages API. */
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Optional override of model id. Defaults to env / opus-4-7. */
  model?: string;
  /** Anthropic max output tokens. Defaults to 4096. */
  maxTokens?: number;
  /** 0.0–1.0, defaults to 0.2 for deterministic authoring tasks. */
  temperature?: number;
  /**
   * Tool definitions — Opus may use web_search for skillboard
   * authoring. Defined per call so the engine controls when this is on.
   */
  tools?: unknown[];
};

export type OpusCallResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsdX10000: number;
  raw: unknown;
  /** Who actually answered. Absent means Anthropic. */
  provider?: "anthropic" | "gemini";
};

/**
 * Run a function that makes an Opus call. The wrapper handles budget
 * checks, calling the model via `callOpusRaw`, and ledger persistence.
 *
 * Usage:
 *
 *   const { text } = await withOpusBudget(
 *     "skillboard_authoring",
 *     () => callOpusRaw({ system: "...", messages: [...] }),
 *   );
 */
export async function withOpusBudget<T extends OpusCallResult>(
  purpose: AiSpendPurpose,
  fn: () => Promise<T>,
): Promise<T> {
  const startOfMonth = monthStart();
  const before = await monthlySpentUsd(startOfMonth);

  if (before >= MONTHLY_CAP_USD) {
    await notify({
      severity: "critical",
      eventType: "opus_budget_critical",
      payload: {
        monthly_spent_usd: before,
        cap_usd: MONTHLY_CAP_USD,
        purpose,
      },
    });
    throw new OpusBudgetExceededError(before);
  }

  let result: T;
  let success = true;
  try {
    result = await fn();
  } catch (err) {
    success = false;
    await db.insert(aiSpendLedger).values({
      model: "opus",
      purpose,
      inputTokens: 0,
      outputTokens: 0,
      costUsdX10000: 0,
      success: false,
    });
    await notify({
      severity: "error",
      eventType: "opus_call_failed",
      payload: {
        purpose,
        message: err instanceof Error ? err.message : "unknown",
      },
    });
    throw err;
  }

  // Persist ledger row, against whichever provider answered.
  await db.insert(aiSpendLedger).values({
    model: result.provider === "gemini" ? "gemini_pro" : "opus",
    purpose,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsdX10000: result.costUsdX10000,
    success: true,
  });

  // Threshold check AFTER persisting this call's cost.
  const afterUsd = before + result.costUsdX10000 / 10_000;
  if (before < WARN_THRESHOLD_USD && afterUsd >= WARN_THRESHOLD_USD) {
    await notify({
      severity: "warn",
      eventType: "opus_budget_warn",
      payload: {
        monthly_spent_usd: afterUsd,
        warn_threshold_usd: WARN_THRESHOLD_USD,
        cap_usd: MONTHLY_CAP_USD,
        triggered_by_purpose: purpose,
      },
    });
  }

  void success; // satisfy linter
  return result;
}

/* ---------- Raw call (used by withOpusBudget; exported for tests) ---------- */

export async function callOpusRaw(args: OpusCallArgs): Promise<OpusCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (process.env.ASSESSMENT_GEMINI_KEY) return callGeminiFallback(args, "ANTHROPIC_API_KEY is not set");
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  if (anthropicKnownOutOfCredit() && process.env.ASSESSMENT_GEMINI_KEY) {
    return callGeminiFallback(args, "Anthropic account is out of credit (cooldown)");
  }

  const body: Record<string, unknown> = {
    model: args.model ?? OPUS_MODEL,
    max_tokens: args.maxTokens ?? 4096,
    messages: args.messages,
  };
  // Newer Claude models (Opus 4.x and later) deprecated `temperature`
  // — they enforce a fixed sampling profile. Only pass temperature if
  // the caller explicitly set one AND we're on an older model. Default
  // omits it so opus-4-7 doesn't 400 on us.
  if (args.temperature !== undefined && !isTemperatureDeprecatedModel(args.model ?? OPUS_MODEL)) {
    body.temperature = args.temperature;
  }
  if (args.system) body.system = args.system;
  if (args.tools && args.tools.length > 0) body.tools = args.tools;

  const bodyString = asciiSafeJsonStringify(body);

  // Retry once on transient errors (5xx, 429, network failures).
  // Anthropic occasionally returns 529 "overloaded" — same pattern.
  let res: Response;
  let attempts = 0;
  const MAX_ATTEMPTS = 2;
  while (true) {
    attempts += 1;
    try {
      res = await fetch(OPUS_ENDPOINT, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: bodyString,
      });
      const isRetryable =
        res.status >= 500 || res.status === 429 || res.status === 529;
      if (res.ok || !isRetryable || attempts >= MAX_ATTEMPTS) break;
      // Back off briefly before retry.
      await new Promise((r) => setTimeout(r, 1500));
    } catch (netErr) {
      if (attempts >= MAX_ATTEMPTS) throw netErr;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (!res!.ok) {
    const text = await res!.text().catch(() => "");

    // An exhausted credit balance arrives as a generic 400, which is how
    // 509 authoring jobs came to sit in `failed` behind a message nobody
    // read as "top up the account". It is not a code fault and no amount
    // of retrying fixes it, so it gets its own message and an alert. The
    // internal OPUS_MONTHLY_CAP_USD gate is separate and says nothing
    // about what is actually left on the account.
    if (/credit balance is too low/i.test(text)) {
      const first = !anthropicKnownOutOfCredit();
      anthropicOutOfCreditAt = Date.now();
      if (first) {
        void notify({
          severity: "critical",
          eventType: "anthropic_credit_exhausted",
          payload: {
            status: res!.status,
            detail: text.slice(0, 300),
            fallback: process.env.ASSESSMENT_GEMINI_KEY ? "gemini" : "none",
          },
        }).catch(() => {});
      }
      if (process.env.ASSESSMENT_GEMINI_KEY) {
        return callGeminiFallback(args, "Anthropic account is out of credit");
      }
      throw new Error(
        "Anthropic account is out of credit and no Gemini key is set, so " +
          "no authoring or scoring can run. Add credit in Plans & Billing " +
          "(or set ASSESSMENT_GEMINI_KEY), then re-run " +
          "scripts/requeue-failed-authoring-jobs.ts to revive the jobs that " +
          "failed while it was empty.",
      );
    }

    throw new Error(`Anthropic ${res!.status}: ${text || res!.statusText}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text =
    json.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("") ?? "";
  const inputTokens = json.usage?.input_tokens ?? 0;
  const outputTokens = json.usage?.output_tokens ?? 0;
  const cost = costUsdX10000(
    "opus",
    inputTokens,
    outputTokens,
  );

  return {
    text,
    inputTokens,
    outputTokens,
    costUsdX10000: cost,
    raw: json,
  };
}

/* ---------- Internal helpers ---------- */

function monthStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function monthlySpentUsd(since: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sum(aiSpendLedger.costUsdX10000).mapWith(Number),
    })
    .from(aiSpendLedger)
    .where(
      and(
        eq(aiSpendLedger.model, "opus"),
        gte(aiSpendLedger.calledAt, since),
      ),
    );

  const totalX10000 = row?.total ?? 0;
  return totalX10000 / 10_000;
}

/**
 * Whether a Claude model id rejects the `temperature` parameter.
 *
 * Anthropic dropped temperature support on Opus 4.x and later — calls
 * with temperature set return 400 invalid_request_error. Earlier models
 * (3.x and below) still accept it. This list grows as new models ship;
 * conservatively, anything matching opus-4* / sonnet-4* / haiku-4* is
 * treated as no-temperature.
 */
function isTemperatureDeprecatedModel(model: string): boolean {
  return /(?:opus|sonnet|haiku)-(?:[4-9]|\d{2,})/.test(model);
}

/* ---------- Gemini stand-in for an Opus call ---------- */

type GeminiGenerateResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

/**
 * The same system + messages on Gemini. Anthropic tool definitions
 * (web_search) have no equivalent here and are dropped; every caller
 * already parses the text it gets back, so the shape of the answer is
 * the caller's prompt, not the provider's. Model ids are walked like
 * gemini.ts does, so a withdrawn id moves to the next.
 */
async function callGeminiFallback(args: OpusCallArgs, reason: string): Promise<OpusCallResult> {
  const key = process.env.ASSESSMENT_GEMINI_KEY;
  if (!key) throw new Error(`${reason}, and ASSESSMENT_GEMINI_KEY is not set.`);
  if (args.tools && args.tools.length > 0) {
    console.warn(`[opus→gemini] ${reason}; running without tools (${args.tools.length} dropped)`);
  } else {
    console.info(`[opus→gemini] ${reason}; running on Gemini`);
  }
  const body: Record<string, unknown> = {
    contents: args.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: args.maxTokens ?? 4096,
      temperature: args.temperature ?? 0.2,
    },
  };
  if (args.system) body.system_instruction = { parts: [{ text: args.system }] };
  const payload = asciiSafeJsonStringify(body);

  const candidates = process.env.GEMINI_AUTHORING_MODEL?.trim()
    ? [process.env.GEMINI_AUTHORING_MODEL.trim()]
    : resolvedGeminiModel
      ? [resolvedGeminiModel]
      : [...GEMINI_FALLBACK_CANDIDATES];
  let lastErr: Error | null = null;
  for (const model of candidates) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (res.status === 404) {
      lastErr = new Error(`Gemini model "${model}" not found`);
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as GeminiGenerateResponse;
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${json.error?.message ?? res.statusText}`);
    }
    if (json.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
    }
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new Error("Gemini returned no text.");
    resolvedGeminiModel = model;
    const inputTokens = json.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      inputTokens,
      outputTokens,
      costUsdX10000: costUsdX10000("gemini_pro", inputTokens, outputTokens),
      raw: json,
      provider: "gemini",
    };
  }
  throw lastErr ?? new Error("Gemini fallback failed.");
}
