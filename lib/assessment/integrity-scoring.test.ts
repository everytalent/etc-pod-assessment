import { describe, expect, it } from "vitest";

import { computeIntegrityScores } from "./integrity-scoring";

const humanAnswers = [
  {
    text: "yeah so i'd probably start by checking the inverter's DC input. if it's reading low, could be shading on one string. i'd swap in a known-good MC4 first, then meter the string.",
    timeSpentSeconds: 180,
  },
  {
    text: "depends on the size. for a 5kwp residential i usually spec a 5.5kwp inverter, but honestly some installers oversize. i wouldn't go past 1.2x.",
    timeSpentSeconds: 90,
  },
  {
    text: "3 things i'd flag: no earthing on the array frame, string voltage above module Vmax, and lack of surge arrestors on the DC side. all NEMSA red flags.",
    timeSpentSeconds: 210,
  },
];

const llmAnswers = [
  {
    text: "Certainly! To troubleshoot a low-performing solar inverter, we should systematically approach the diagnostic process. First, let's verify the DC input readings from each string using a multimeter. Furthermore, it is important to check for any environmental factors that could impact performance, such as shading, soiling, or module degradation. In conclusion, a methodical approach ensures accurate diagnosis.",
    timeSpentSeconds: 8,
  },
  {
    text: "Great question! Sizing a solar inverter requires careful consideration of the array's peak DC output. Furthermore, we must account for the DC-to-AC ratio, which typically falls between 1.15 and 1.30 for residential installations. Moreover, temperature derating factors should be applied. In summary, the inverter should be sized to slightly under the array's peak capacity.",
    timeSpentSeconds: 6,
  },
  {
    text: "Absolutely! Let me break this down into three critical safety issues. First, inadequate grounding of the array frame poses a serious electrical hazard. Furthermore, exceeding module Vmax during cold weather can permanently damage the equipment. Moreover, the absence of surge protection devices on the DC side leaves the system vulnerable. Key points: grounding, voltage limits, and surge protection are non-negotiable.",
    timeSpentSeconds: 7,
  },
];

describe("computeIntegrityScores", () => {
  it("returns zeros when no text answers exist", () => {
    const scores = computeIntegrityScores({ answers: [] });
    expect(scores.aiLikelihoodScore).toBe(0);
    expect(scores.styleShiftScore).toBe(0);
  });

  it("keeps ai_likelihood low for authentic short human answers", () => {
    const scores = computeIntegrityScores({ answers: humanAnswers });
    expect(scores.aiLikelihoodScore).toBeLessThan(0.3);
  });

  it("flags obvious LLM output with tells + implausible typing speed", () => {
    const scores = computeIntegrityScores({ answers: llmAnswers });
    expect(scores.aiLikelihoodScore).toBeGreaterThan(0.4);
  });

  it("paste_count > 0 pushes the composite up", () => {
    const withoutPaste = computeIntegrityScores({ answers: humanAnswers });
    const withPaste = computeIntegrityScores({
      answers: humanAnswers,
      pasteCount: 1,
    });
    expect(withPaste.aiLikelihoodScore).toBeGreaterThan(
      withoutPaste.aiLikelihoodScore,
    );
  });

  it("style_shift_score is 0 when there aren't enough sentences to say anything", () => {
    const scores = computeIntegrityScores({
      answers: [{ text: "yeah", timeSpentSeconds: 60 }],
    });
    expect(scores.styleShiftScore).toBe(0);
  });

  it("style_shift_score is higher for varied human writing than uniform LLM writing", () => {
    const human = computeIntegrityScores({ answers: humanAnswers });
    const llm = computeIntegrityScores({ answers: llmAnswers });
    expect(human.styleShiftScore).toBeGreaterThan(llm.styleShiftScore);
  });
});
