/**
 * Provider-agnostic helpers for AI-suggested open-ended scoring.
 *
 * The prompt builder and JSON parser are identical whether the call goes
 * to Gemini or Kimi — only the transport (model + endpoint) differs.
 * Keeping this here means a behaviour change (e.g. different scoring
 * guidance) updates both providers in one place.
 */

export type ScoreSuggestion = {
  suggestedScore: number;
  rationale: string;
  hits: string[];
  misses: string[];
  redFlagsTriggered: string[];
  /**
   * Optional cheating-risk read on the answer itself. The cross-check
   * endpoint persists this on ai_scores; Kimi's proposal is auto-applied
   * to the answer (as second-assessor) when no human override exists.
   */
  integrityProposal?: "low" | "mid" | "high";
  integrityProposalRationale?: string;
};

export function buildScoringPrompt(args: {
  questionText: string;
  rubric: string;
  candidateAnswer: string;
  maxPoints: number;
}): string {
  return `You are scoring a single open-ended answer on a solar engineering assessment.

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
  "redFlagsTriggered": ["<red-flag rubric item the answer hit, if any>", ...],
  "integrityProposal": "low" | "mid" | "high",
  "integrityProposalRationale": "<one sentence, plain English, why this integrity level>"
}

Scoring guidance:
- Award full credit if the answer demonstrates understanding of the concept, even if the exact rubric phrase isn't used.
- A red flag fully triggered should pull the score down sharply (often to 0 or 1) — these indicate dangerous misconceptions.
- "Must hit N" rules in the rubric: if the answer hits fewer than N required items (counting paraphrases), cap the score proportionally.
- Empty / blank / "(silence)" answers score 0.

Integrity guidance (judged from the answer text alone):
- low  — answer reads as the candidate's own work, no signs of copy-paste, AI generation, or generic boilerplate
- mid  — some signals (very generic phrasing, oddly polished for the apparent skill level, mismatch in voice between sentences)
- high — clear signs of AI-generated text, near-verbatim from a known source, or evasive non-answers that look intentional
- When in doubt, prefer "low". Soft signals like tab switches are handled separately at the response level.`;
}

/**
 * Parse the raw model output into a ScoreSuggestion. Strips ```json fences
 * Gemini occasionally adds despite being told not to. Throws a clear
 * error message on malformed JSON so the caller can surface it cleanly.
 */
export function parseScoreSuggestion(
  raw: string,
  maxPoints: number,
): ScoreSuggestion {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Model returned non-JSON: ${cleaned.slice(0, 140)}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Model returned non-object JSON.");
  }
  const obj = parsed as Record<string, unknown>;
  const score = Number(obj.suggestedScore);
  if (!Number.isFinite(score)) {
    throw new Error("Model didn't return a numeric suggestedScore.");
  }
  const clamped = Math.max(0, Math.min(maxPoints, Math.round(score)));
  const stringArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const integrityProposal: "low" | "mid" | "high" | undefined =
    obj.integrityProposal === "low" ||
    obj.integrityProposal === "mid" ||
    obj.integrityProposal === "high"
      ? obj.integrityProposal
      : undefined;
  return {
    suggestedScore: clamped,
    rationale: typeof obj.rationale === "string" ? obj.rationale : "",
    hits: stringArr(obj.hits),
    misses: stringArr(obj.misses),
    redFlagsTriggered: stringArr(obj.redFlagsTriggered),
    integrityProposal,
    integrityProposalRationale:
      typeof obj.integrityProposalRationale === "string"
        ? obj.integrityProposalRationale
        : undefined,
  };
}
