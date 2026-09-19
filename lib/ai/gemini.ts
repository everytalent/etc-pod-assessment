/**
 * Gemini API client — only what we need for Plan C (audio transcription
 * today; auto-scoring lands in Slice 2).
 *
 * Uses Google's REST endpoint directly so we avoid pulling in the full
 * @google/generative-ai SDK for a single call. Audio under 20 MB is sent
 * inline as base64 — voice answers are capped at 5 minutes upstream so
 * even a high-bitrate webm comfortably fits.
 *
 * Requires ASSESSMENT_GEMINI_KEY.
 */

import { asciiSafeJsonStringify } from "@/lib/tenant/sanitise";

/**
 * Model ids to try, in order, until one is not refused.
 *
 * These were single constants pinned to gemini-2.5-*. Google withdrew
 * 2.5 Pro from new keys ("no longer available to new users"), so every
 * scoring call started returning 404 and answers stopped being scored
 * altogether. Note the older comment this replaces: a previous attempt
 * to pin gemini-3.1 failed because that name did not exist yet. Pinning
 * one id breaks in both directions, whichever id you choose.
 *
 * So: a list, newest first, ending in a `-latest` alias that Google
 * keeps pointed at something current. GEMINI_SCORING_MODEL and
 * GEMINI_TRANSCRIBE_MODEL override outright, so a new name can be rolled
 * out through env without a deploy.
 */
const TRANSCRIBE_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash",
] as const;

const SCORING_CANDIDATES = [
  "gemini-3.1-pro-preview",
  "gemini-pro-latest",
  "gemini-2.5-pro",
] as const;

/** Whichever candidate last worked, per role, cached for the process. */
const resolvedModel: Record<"scoring" | "transcribe", string | null> = {
  scoring: null,
  transcribe: null,
};

function modelsToTry(role: "scoring" | "transcribe"): string[] {
  const configured =
    role === "scoring"
      ? process.env.GEMINI_SCORING_MODEL?.trim()
      : process.env.GEMINI_TRANSCRIBE_MODEL?.trim();
  if (configured) return [configured];
  const cached = resolvedModel[role];
  if (cached) return [cached];
  return [
    ...(role === "scoring" ? SCORING_CANDIDATES : TRANSCRIBE_CANDIDATES),
  ];
}

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
};

function getApiKey(): string {
  const key = process.env.ASSESSMENT_GEMINI_KEY;
  if (!key) throw new Error("ASSESSMENT_GEMINI_KEY is not set");
  return key;
}

/**
 * Try each candidate id until one answers. Only a 404 (unknown or
 * withdrawn model) moves to the next: a quota error or a safety block
 * would fail identically on every id, so failing fast beats retrying the
 * same refusal three times.
 */
async function callGemini(
  parts: GeminiPart[],
  role: "scoring" | "transcribe",
): Promise<string> {
  const candidates = modelsToTry(role);
  let lastErr: unknown;
  for (const model of candidates) {
    try {
      const out = await callGeminiOnce(parts, model);
      resolvedModel[role] = model;
      if (model !== candidates[0]) {
        console.info(`[gemini] using "${model}" for ${role} (earlier ids refused)`);
      }
      return out;
    } catch (err) {
      lastErr = err;
      if ((err as { status?: number }).status !== 404) throw err;
    }
  }
  throw lastErr;
}

async function callGeminiOnce(parts: GeminiPart[], model: string): Promise<string> {
  const res = await fetch(`${endpointFor(model)}?key=${getApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: asciiSafeJsonStringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(humaniseGeminiError(res.status, text)) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request (${data.promptFeedback.blockReason}).`);
  }
  const out = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!out) {
    throw new Error("Gemini returned no text.");
  }
  return out;
}

/**
 * Translate a Gemini error response into a sentence a non-engineer can act
 * on. Google emits 100+ lines of JSON for a 429 — the user-facing UI just
 * needs the gist: what failed, and what to do about it.
 */
function humaniseGeminiError(status: number, body: string): string {
  type GeminiErrorBody = {
    error?: {
      message?: string;
      details?: {
        "@type"?: string;
        retryDelay?: string;
        violations?: { quotaMetric?: string }[];
      }[];
    };
  };
  let parsed: GeminiErrorBody | null = null;
  try {
    parsed = JSON.parse(body) as GeminiErrorBody;
  } catch {
    // Body wasn't JSON — fall through to generic handling below.
  }

  if (status === 429) {
    const details = parsed?.error?.details ?? [];
    const violations = details
      .flatMap((d) => d.violations ?? [])
      .filter((v): v is { quotaMetric: string } => Boolean(v.quotaMetric));
    const hasZeroFreeTier = violations.some((v) =>
      v.quotaMetric.includes("free_tier"),
    );
    if (hasZeroFreeTier) {
      return "Gemini quota: this API key has no free-tier allowance. Enable billing on the Google Cloud project, or generate a new key from aistudio.google.com.";
    }
    const retry = details.find((d) => d["@type"]?.includes("RetryInfo"))
      ?.retryDelay;
    return retry
      ? `Gemini rate limit hit. Try again in ${retry}.`
      : "Gemini rate limit hit. Try again shortly.";
  }

  if (status === 401 || status === 403) {
    return "Gemini API key is invalid or revoked. Check ASSESSMENT_GEMINI_KEY.";
  }

  if (status === 400) {
    const msg = parsed?.error?.message ?? "request was rejected";
    return `Gemini rejected the request: ${msg.slice(0, 140)}`;
  }

  if (status >= 500) {
    return `Gemini is having a moment (${status}). Try again in a few seconds.`;
  }

  const msg = parsed?.error?.message;
  return msg ? `Gemini ${status}: ${msg.slice(0, 140)}` : `Gemini ${status} error.`;
}

/**
 * Transcribe an audio buffer to plain text. The prompt asks Gemini to keep
 * disfluencies out and emit raw spoken content — closer to a clean reviewer
 * transcript than a verbatim phonetic dump.
 */
export async function transcribeAudio(args: {
  audio: ArrayBuffer | Uint8Array;
  mimeType: string;
}): Promise<string> {
  const bytes =
    args.audio instanceof Uint8Array ? args.audio : new Uint8Array(args.audio);
  const base64 = Buffer.from(bytes).toString("base64");
  return callGemini(
    [
      {
        text: "Transcribe the following audio to plain English text. Output only the transcript — no preamble, no quotation marks, no speaker labels. Skip filler words like 'um', 'uh', 'like'. If the audio contains no speech, output the single word: (silence)",
      },
      { inline_data: { mime_type: args.mimeType, data: base64 } },
    ],
    "transcribe",
  );
}

/**
 * Suggest a score for an open-ended answer using Gemini 2.5 Pro.
 * Prompt + parse logic live in lib/ai/scoring.ts so Kimi gets the
 * same treatment.
 */
import {
  buildScoringPrompt,
  parseScoreSuggestion,
  type ScoreSuggestion,
} from "./scoring";
export type { ScoreSuggestion };

export async function scoreOpenEnded(args: {
  questionText: string;
  rubric: string;
  candidateAnswer: string;
  maxPoints: number;
}): Promise<ScoreSuggestion> {
  const raw = await callGemini(
    [{ text: buildScoringPrompt(args) }],
    "scoring",
  );
  return parseScoreSuggestion(raw, args.maxPoints);
}
