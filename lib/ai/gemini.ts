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

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

async function callGemini(parts: GeminiPart[]): Promise<string> {
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${getApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }
  const out = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!out) {
    throw new Error("Gemini returned no text");
  }
  return out;
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
  return callGemini([
    {
      text: "Transcribe the following audio to plain English text. Output only the transcript — no preamble, no quotation marks, no speaker labels. Skip filler words like 'um', 'uh', 'like'. If the audio contains no speech, output the single word: (silence)",
    },
    { inline_data: { mime_type: args.mimeType, data: base64 } },
  ]);
}
