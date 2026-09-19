/**
 * Kimi (Moonshot AI) client — second-opinion AI scorer for the cross-check
 * pipeline. Moonshot exposes an OpenAI-compatible chat/completions API,
 * so this file is just an HTTPS POST wrapper plus a thin response parser.
 *
 * Requires KIMI_API_KEY. Model defaults to KIMI_MODEL or kimi-k2.
 */

import { asciiSafeJsonStringify } from "@/lib/tenant/sanitise";

import {
  buildScoringPrompt,
  parseScoreSuggestion,
  type ScoreSuggestion,
} from "./scoring";

const KIMI_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";

/**
 * Model ids to try, in order, until one is not rejected as unknown.
 *
 * This used to be a single hard-coded "moonshot-v1-8k", on the note that
 * kimi-k2 was an open-source release name rather than an API model. That
 * stopped being true: Moonshot retired the moonshot-v1-* generation on
 * the international platform and serves the kimi-k2 family instead, so
 * every scoring call started coming back 404 "model not found". Kimi is
 * one of two cross-checking scorers, so the effect was silent rather
 * than loud: answers still got a Gemini score, they just stopped being
 * cross-checked, and the consensus they were supposed to feed never
 * happened.
 *
 * A list rather than a constant because this has now broken once on a
 * vendor rename and will again. KIMI_MODEL still wins outright when set,
 * so a new id can be rolled out through env without a deploy; the rest
 * is a self-healing fallback, newest first, with the legacy id kept last
 * for any account still provisioned against it.
 */
const MODEL_CANDIDATES = [
  "kimi-k2-0905-preview",
  "kimi-k2-turbo-preview",
  "kimi-k2-0711-preview",
  "moonshot-v1-8k",
] as const;

/**
 * The candidate that last worked. Cached for the life of the process so
 * we pay the discovery cost once per cold start, not once per answer.
 */
let resolvedModel: string | null = null;

/**
 * Ask Moonshot what it actually serves.
 *
 * The hard-coded list is a guess about someone else's product naming,
 * and it has now been wrong twice: moonshot-v1-* was withdrawn, and the
 * kimi-k2-* ids that replaced it were refused too. Rather than guess a
 * third time, fall back to the provider's own catalogue and pick from
 * it. Cached for the process, so this costs one extra request per cold
 * start in the worst case and nothing at all once something works.
 */
async function discoverModels(): Promise<string[]> {
  try {
    const res = await fetch(KIMI_ENDPOINT.replace("/chat/completions", "/models"), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // Prefer chat models over embeddings, vision or anything else whose
    // name marks it as a different shape of thing.
    const excluded = /embed|whisper|tts|vision|image|rerank|moderation/i;
    const usable = ids.filter((id) => !excluded.test(id));
    // Newest-looking first: higher version numbers tend to sort later,
    // and a turbo variant is cheaper for a scoring call than a flagship.
    usable.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (usable.length > 0) {
      console.info(`[kimi] discovered models: ${usable.slice(0, 5).join(", ")}`);
    }
    return usable;
  } catch (err) {
    console.warn(`[kimi] model discovery failed: ${String(err)}`);
    return [];
  }
}

function modelsToTry(): string[] {
  const configured = process.env.KIMI_MODEL?.trim();
  if (configured) return [configured];
  if (resolvedModel) return [resolvedModel];
  return [...MODEL_CANDIDATES];
}

type KimiResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string };
};

function getApiKey(): string {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error("KIMI_API_KEY is not set");
  return key;
}

async function callKimiOnce(prompt: string, model: string): Promise<string> {
  const res = await fetch(KIMI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: asciiSafeJsonStringify({
      model,
      messages: [{ role: "user", content: prompt }],
      // Ask for JSON-only output where supported. If the deployed model
      // doesn't honour this we still recover via the fence-stripping
      // parser in scoring.ts.
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(humaniseKimiError(res.status, text)) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as KimiResponse;
  if (data.error) {
    throw new Error(`Kimi: ${data.error.message ?? data.error.type ?? "unknown"}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Kimi returned no content.");
  return content;
}

/**
 * Wraps callKimiOnce with up to two retries on transient failures (5xx,
 * 429, intermittent 404s — Moonshot has been observed to flake the
 * occasional model lookup under load). Auth errors (401/403) and bad
 * input (400) are surfaced immediately — retrying won't help.
 */
async function callKimi(prompt: string): Promise<string> {
  const candidates = modelsToTry();
  let lastErr: unknown;

  for (const model of candidates) {
    try {
      const out = await callKimiWithRetries(prompt, model);
      // Remember what worked so later answers skip straight to it.
      resolvedModel = model;
      if (candidates.length > 1 && model !== candidates[0]) {
        console.info(
          `[kimi] using model "${model}" (earlier candidates were rejected)`,
        );
      }
      return out;
    } catch (err) {
      lastErr = err;
      // Only an unknown-model answer justifies trying the next id.
      // Anything else (auth, rate limit, outage) would fail identically
      // on every candidate, so failing fast beats hammering the API
      // once per model.
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  // Every id we knew about was refused. Ask Moonshot for its catalogue
  // and try what it names, rather than failing on our own stale guess.
  for (const model of await discoverModels()) {
    if (candidates.includes(model)) continue;
    try {
      const out = await callKimiWithRetries(prompt, model);
      resolvedModel = model;
      console.info(`[kimi] recovered via discovered model "${model}"`);
      return out;
    } catch (err) {
      lastErr = err;
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  throw lastErr;
}

/**
 * Retries one model on genuinely transient failures. 404 is deliberately
 * NOT retried here: a model id is either served or it is not, and the
 * old code spent three attempts and two backoffs discovering that on
 * every single answer. Choosing another id is callKimi's job.
 */
async function callKimiWithRetries(
  prompt: string,
  model: string,
): Promise<string> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callKimiOnce(prompt, model);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const transient =
        status === 429 || (typeof status === "number" && status >= 500);
      if (!transient || attempt === MAX_ATTEMPTS) throw err;
      // Exponential backoff: 400 ms, 1200 ms.
      await new Promise((r) => setTimeout(r, 400 * attempt ** 2));
    }
  }
  throw lastErr;
}

function humaniseKimiError(status: number, body: string): string {
  let message: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    message = parsed.error?.message;
  } catch {
    // Fall through.
  }
  if (status === 401 || status === 403) {
    return "Kimi API key is invalid or revoked. Check KIMI_API_KEY.";
  }
  if (status === 429) {
    return "Kimi rate limit hit. Try again shortly.";
  }
  if (status >= 500) {
    return `Kimi is having a moment (${status}). Try again soon.`;
  }
  if (status === 404) {
    return (
      "Kimi rejected every model id we know: " +
      MODEL_CANDIDATES.join(", ") +
      ". Moonshot has probably renamed them again. Set KIMI_MODEL to a " +
      "current id from https://platform.moonshot.ai and it takes effect " +
      "without a deploy."
    );
  }
  return message ? `Kimi ${status}: ${message.slice(0, 140)}` : `Kimi ${status} error.`;
}

export async function scoreOpenEndedKimi(args: {
  questionText: string;
  rubric: string;
  candidateAnswer: string;
  maxPoints: number;
}): Promise<ScoreSuggestion> {
  const raw = await callKimi(buildScoringPrompt(args));
  return parseScoreSuggestion(raw, args.maxPoints);
}

/* ---------- Shared chat helper ---------- */

export const KIMI_CHAT_ENDPOINT = KIMI_ENDPOINT;

export interface KimiChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Which candidate id actually answered. Useful in logs. */
  model: string;
}

/**
 * One Moonshot chat call, with the same model fallback the scorer uses.
 *
 * Synthesis and the learning-summary updater each had their own copy of
 * the endpoint, their own hard-coded moonshot-v1-* default and their own
 * fetch, so the vendor's model rename broke all three independently and
 * would have had to be fixed in three places. They share this now, which
 * means a future rename is one list in one file.
 */
export async function callKimiChat(args: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Ask for a JSON object back. Defaults true, because most callers here
   * parse structured output. The learning-summary updater wants prose
   * and explicitly asks for "no JSON", so it passes false: forcing
   * json_object on that prompt would have it return a quoted blob the
   * summary renderer then shows verbatim to a learner.
   */
  json?: boolean;
}): Promise<KimiChatResult> {
  const candidates = modelsToTry();
  let lastErr: unknown;

  for (const model of candidates) {
    try {
      const out = await postKimiChat(args, model);
      resolvedModel = model;
      return out;
    } catch (err) {
      lastErr = err;
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  // Same recovery as the scorer: if every id we know is refused, use the
  // provider's catalogue instead of failing on a stale guess.
  for (const model of await discoverModels()) {
    if (candidates.includes(model)) continue;
    try {
      const out = await postKimiChat(args, model);
      resolvedModel = model;
      console.info(`[kimi] recovered via discovered model "${model}"`);
      return out;
    } catch (err) {
      lastErr = err;
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }

  throw lastErr;
}

/** One chat request against a named model. Extracted so the candidate
 *  walk and the discovery fallback share exactly one request shape. */
async function postKimiChat(
  args: { prompt: string; maxTokens?: number; temperature?: number; json?: boolean },
  model: string,
): Promise<KimiChatResult> {
  const res = await fetch(KIMI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: asciiSafeJsonStringify({
      model,
      temperature: args.temperature ?? 0.2,
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
      ...(args.json === false
        ? {}
        : { response_format: { type: "json_object" as const } }),
      messages: [{ role: "user", content: args.prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(humaniseKimiError(res.status, body)) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Kimi returned empty content");

  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model,
  };
}
