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

import { costUsdX10000 } from "./pricing";

const OPUS_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPUS_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";

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

  // Persist ledger row.
  await db.insert(aiSpendLedger).values({
    model: "opus",
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
    throw new Error("ANTHROPIC_API_KEY is not set");
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

  // Belt-and-suspenders: Undici (Node's fetch) treats the body string
  // as a ByteString in some code paths and rejects U+2028 / U+2029
  // and other non-Latin-1 characters before encoding. Escape every
  // non-ASCII codepoint in the final body string to \uXXXX sequences
  // so the bytes on the wire are pure ASCII. JSON parsers reconstruct
  // the same logical string on the other side.
  const escapeNonAscii = new RegExp(
    "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\uFFFF]",
    "g",
  );
  const bodyString = JSON.stringify(body).replace(
    escapeNonAscii,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );

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
