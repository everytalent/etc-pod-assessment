/**
 * Response-level integrity heuristics.
 *
 * Emits two soft signals used by the tenant-facing integrity report:
 *
 *   ai_likelihood_score (0-1): probability the response was drafted with
 *   outside AI assistance. Composite of five weak signals — none is
 *   proof on its own, but their combination correlates with LLM-drafted
 *   answers in practice.
 *
 *   style_shift_score (0-1): mean absolute deviation of average sentence
 *   length across the response's text answers, normalised to 0-1.
 *   Genuine human writing varies naturally; LLM-drafted answers are
 *   suspiciously uniform.
 *
 * These are heuristics, not a classifier. A determined cheater can beat
 * them. Once we have enough real completions to fit a discriminative
 * model, swap this out for that. For now the signals surface obvious
 * cases (paste-only responses, uniform LLM cadence, well-known tells)
 * and let the tenant do the human read on the rest.
 */

const AI_TELLS: RegExp[] = [
  /^(?:certainly|sure|absolutely|of course|great question|let me)\b/im,
  /\bin summary\b/i,
  /\bin conclusion\b/i,
  /\bit['’]s worth noting\b/i,
  /\bas an ai\b/i,
  /\bhere['’]s a\b/i,
  /\blet['’]s break this down\b/i,
  /\bkey points?:\b/i,
  /\bdelve\b/i,
  /\bfurthermore\b/i,
  /\bmoreover\b/i,
];

export type AnswerText = {
  text: string;
  timeSpentSeconds: number;
};

export type IntegritySignalInput = {
  answers: AnswerText[];
  pasteCount?: number;
  tabBlurCount?: number;
};

export type IntegrityScores = {
  aiLikelihoodScore: number;
  styleShiftScore: number;
};

/**
 * Split answer text into sentences by strong punctuation boundaries.
 * Not a true NLP sentence tokeniser — a naive regex is enough for
 * length-variance signals.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function meanAbsDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const dev = values.reduce((s, v) => s + Math.abs(v - mean), 0) / values.length;
  return dev;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Per-answer AI-suspicion contribution. Returns 0 (looks fine) → 1
 * (multiple tells firing). We aggregate these across the response.
 */
function perAnswerAiSuspicion(answer: AnswerText): number {
  const text = answer.text.trim();
  if (text.length === 0) return 0;

  const tellHits = AI_TELLS.reduce(
    (acc, re) => acc + (re.test(text) ? 1 : 0),
    0,
  );

  // Speed signal: chars per second on this answer.
  const charsPerSec =
    answer.timeSpentSeconds > 0
      ? text.length / answer.timeSpentSeconds
      : text.length; // no time recorded = treat as instant

  // A human typing without any thought at ~50wpm is ~4-5 chars/sec.
  // Anything above 15 chars/sec sustained across a long answer looks
  // pasted. Under 15 we contribute nothing from speed.
  const speedSusp = charsPerSec > 15 && text.length > 200 ? 0.5 : 0;

  // Cap contribution per answer at 1.0.
  return clamp01(0.15 * tellHits + speedSusp);
}

export function computeIntegrityScores(
  input: IntegritySignalInput,
): IntegrityScores {
  const texts = input.answers
    .filter((a) => a.text.trim().length > 0);

  if (texts.length === 0) {
    return { aiLikelihoodScore: 0, styleShiftScore: 0 };
  }

  // AI-likelihood composite (weighted contributions clamped to 0-1):
  //   0.30 * mean per-answer AI-suspicion (tells + paste-speed)
  //   0.25 * paste-events indicator (any pastes → strong signal)
  //   0.20 * long-answer count normalised (>3 lengthy = suspicious)
  //   0.15 * style-shift score (low variance → likely LLM)
  //   0.10 * tab-blur presence (context: candidate flipping to another app)
  const perAnswer = texts.map(perAnswerAiSuspicion);
  const meanPerAnswer =
    perAnswer.reduce((s, v) => s + v, 0) / perAnswer.length;

  const pasteScore = (input.pasteCount ?? 0) > 0 ? 1 : 0;

  const longAnswers = texts.filter((a) => a.text.length > 400).length;
  const longAnswerScore = clamp01(longAnswers / 3);

  const sentenceLengths = texts
    .map((a) =>
      splitSentences(a.text).map((s) => s.length),
    )
    .flat();
  const perAnswerAvgSentenceLen = texts.map((a) => {
    const s = splitSentences(a.text);
    if (s.length === 0) return 0;
    return s.reduce((sum, sent) => sum + sent.length, 0) / s.length;
  });
  // Normalise MAD to 0-1: 0 = perfectly uniform (worst), 40+ = highly
  // variable (best). Inverted so low variance → high suspicion.
  const mad = meanAbsDeviation(perAnswerAvgSentenceLen);
  const styleUniformity = clamp01(1 - mad / 40);
  const styleShiftScore = clamp01(mad / 40);

  const tabBlurScore = (input.tabBlurCount ?? 0) >= 3 ? 1 : 0;

  const aiLikelihoodScore = clamp01(
    0.3 * meanPerAnswer +
      0.25 * pasteScore +
      0.2 * longAnswerScore +
      0.15 * styleUniformity +
      0.1 * tabBlurScore,
  );

  // Sentence-length dispersion sanity check — if there aren't enough
  // sentences to say anything meaningful, flatten the styleShiftScore.
  const finalStyleShiftScore =
    sentenceLengths.length < 5 ? 0 : styleShiftScore;

  return {
    aiLikelihoodScore,
    styleShiftScore: finalStyleShiftScore,
  };
}
