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

// Per-call model. Transcription uses Flash (cheap, audio-native).
// Scoring uses 2.5 Pro because rubric-grading benefits from stronger
// reasoning and the cost is amortised over a small per-day volume of
// admin reviews. (We tried `gemini-3.1` originally — Google doesn't
// publish that name; v1beta returns 404. 2.5 Pro is the strongest stable
// model on the public API as of 2026-05.)
const TRANSCRIBE_MODEL = "gemini-2.5-flash";
const SCORING_MODEL = "gemini-2.5-pro";

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

async function callGemini(parts: GeminiPart[], model: string): Promise<string> {
  const res = await fetch(`${endpointFor(model)}?key=${getApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humaniseGeminiError(res.status, text));
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
    TRANSCRIBE_MODEL,
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
    SCORING_MODEL,
  );
  return parseScoreSuggestion(raw, args.maxPoints);
}
