/**
 * Kimi (Moonshot AI) client — second-opinion AI scorer for the cross-check
 * pipeline. Moonshot exposes an OpenAI-compatible chat/completions API,
 * so this file is just an HTTPS POST wrapper plus a thin response parser.
 *
 * Requires KIMI_API_KEY. Model defaults to KIMI_MODEL or kimi-k2.
 */

import {
  buildScoringPrompt,
  parseScoreSuggestion,
  type ScoreSuggestion,
} from "./scoring";

const KIMI_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";
// Moonshot's global API ships under moonshot-v1-* model IDs (kimi-k2 is
// the open-source release name, not an API model). 8k context is enough
// for question + rubric + transcript answer; bump to moonshot-v1-32k via
// KIMI_MODEL env if you grade longer responses.
const DEFAULT_MODEL = "moonshot-v1-8k";

type KimiResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string };
};

function getApiKey(): string {
  const key = process.env.KIMI_API_KEY;
  if (!key) throw new Error("KIMI_API_KEY is not set");
  return key;
}

async function callKimiOnce(prompt: string): Promise<string> {
  const model = process.env.KIMI_MODEL ?? DEFAULT_MODEL;
  const res = await fetch(KIMI_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callKimiOnce(prompt);
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const transient =
        status === 429 ||
        status === 404 ||
        (typeof status === "number" && status >= 500);
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
    return `Kimi model not found. Set KIMI_MODEL to a valid Moonshot model id.`;
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
