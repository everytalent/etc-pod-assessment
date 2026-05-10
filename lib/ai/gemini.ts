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
// Scoring uses 3.1 because rubric-grading benefits from stronger reasoning
// and the cost is amortised over a small per-day volume of admin reviews.
const TRANSCRIBE_MODEL = "gemini-2.5-flash";
const SCORING_MODEL = "gemini-3.1";

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
 * Suggest a score for an open-ended answer given the question, the rubric
 * the assessment author wrote, and the candidate's answer. Returns the
 * suggested score (0..maxPoints), a one-line rationale, and a list of the
 * rubric items the answer hit/missed.
 *
 * The model is told to extend rubric logic with general engineering
 * knowledge — paraphrases of required concepts should still earn credit.
 */
export type ScoreSuggestion = {
  suggestedScore: number;
  rationale: string;
  hits: string[];
  misses: string[];
  redFlagsTriggered: string[];
};

export async function scoreOpenEnded(args: {
  questionText: string;
  rubric: string;
  candidateAnswer: string;
  maxPoints: number;
}): Promise<ScoreSuggestion> {
  const prompt = `You are scoring a single open-ended answer on a solar engineering assessment.

QUESTION:
${args.questionText}

SCORING RUBRIC (author-written — extend the logic with general engineering knowledge; reward paraphrases that demonstrate the same concept):
${args.rubric}

CANDIDATE ANSWER:
${args.candidateAnswer}

MAX POINTS: ${args.maxPoints} (integer; 0 means complete miss, ${args.maxPoints} means full credit)

Return STRICT JSON matching this schema (no markdown, no code fences, no preamble):
{
  "suggestedScore": <integer between 0 and ${args.maxPoints}>,
  "rationale": "<one sentence, plain English, why this score>",
  "hits": ["<rubric item the answer covered>", ...],
  "misses": ["<rubric item the answer did not cover>", ...],
  "redFlagsTriggered": ["<red-flag rubric item the answer hit, if any>", ...]
}

Scoring guidance:
- Award full credit if the answer demonstrates understanding of the concept, even if the exact rubric phrase isn't used.
- A red flag fully triggered should pull the score down sharply (often to 0 or 1) — these indicate dangerous misconceptions.
- "Must hit N" rules in the rubric: if the answer hits fewer than N required items (counting paraphrases), cap the score proportionally.
- Empty / blank / "(silence)" answers score 0.`;

  const raw = await callGemini([{ text: prompt }], SCORING_MODEL);
  return parseScoreSuggestion(raw, args.maxPoints);
}

function parseScoreSuggestion(raw: string, maxPoints: number): ScoreSuggestion {
  // Strip code-fences if Gemini wrapped the JSON in ```json ... ``` despite
  // being told not to.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Gemini returned non-JSON: ${cleaned.slice(0, 140)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini returned non-object JSON.");
  }
  const obj = parsed as Record<string, unknown>;
  const score = Number(obj.suggestedScore);
  if (!Number.isFinite(score)) {
    throw new Error("Gemini didn't return a numeric suggestedScore.");
  }
  const clamped = Math.max(0, Math.min(maxPoints, Math.round(score)));
  const stringArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return {
    suggestedScore: clamped,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    hits: stringArr(obj.hits),
    misses: stringArr(obj.misses),
    redFlagsTriggered: stringArr(obj.redFlagsTriggered),
  };
}
