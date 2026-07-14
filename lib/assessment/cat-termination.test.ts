import { describe, expect, it } from "vitest";

import {
  decideNext,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  priorMeanForBand,
  SE_STOP_THRESHOLD,
  type CatAnswer,
  type CatCandidateQuestion,
} from "./cat-termination";

const pool = (): CatCandidateQuestion[] =>
  Array.from({ length: 30 }, (_, i) => ({
    id: `q${i}`,
    difficulty: 1 + (i % 10),
  }));

function runToTermination(scoreForDifficulty: (d: number) => number) {
  const answers: CatAnswer[] = [];
  let remaining = pool();
  const trajectory: number[] = [];
  for (let step = 0; step < 40; step++) {
    const decision = decideNext(answers, remaining);
    if (decision.kind === "end") {
      return { decision, answers, trajectory };
    }
    const q = remaining.find((c) => c.id === decision.questionId)!;
    trajectory.push(decision.posterior.mean);
    answers.push({
      difficulty: q.difficulty,
      scoreRatio: scoreForDifficulty(q.difficulty),
    });
    remaining = remaining.filter((c) => c.id !== q.id);
  }
  throw new Error("never terminated");
}

describe("decideNext", () => {
  it("terminates on confidence for a clearly strong candidate", () => {
    const { decision, answers } = runToTermination((d) =>
      d <= 7 ? 1 : 0.3,
    );
    expect(decision.kind).toBe("end");
    if (decision.kind !== "end") throw new Error();
    expect(decision.reason).toBe("confidence_reached");
    expect(decision.posterior.mean).toBeGreaterThan(6);
    expect(decision.posterior.sd).toBeLessThanOrEqual(SE_STOP_THRESHOLD);
    expect(answers.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    expect(answers.length).toBeLessThan(MAX_QUESTIONS);
  });

  it("terminates on confidence for a clearly weak candidate", () => {
    const { decision } = runToTermination((d) => (d <= 3 ? 1 : 0));
    expect(decision.kind).toBe("end");
    if (decision.kind !== "end") throw new Error();
    expect(decision.reason).toBe("confidence_reached");
    expect(decision.posterior.mean).toBeLessThan(4);
  });

  it("still terminates cleanly when the candidate answers half-credit throughout", () => {
    const { decision, answers } = runToTermination(() => 0.5);
    expect(decision.kind).toBe("end");
    if (decision.kind !== "end") throw new Error();
    expect(["hard_cap_hit", "confidence_reached"]).toContain(
      decision.reason,
    );
    // Ambiguous answers should never terminate faster than the min
    // questions bound.
    expect(answers.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    // Posterior should stay near the prior mean when every answer is
    // uninformative-about-direction.
    expect(Math.abs(decision.posterior.mean - 5)).toBeLessThan(1);
  });

  it("does not stop before MIN_QUESTIONS even if the posterior is tight", () => {
    const answers: CatAnswer[] = [
      { difficulty: 5, scoreRatio: 1 },
      { difficulty: 5, scoreRatio: 1 },
      { difficulty: 5, scoreRatio: 1 },
    ];
    const decision = decideNext(answers, pool());
    expect(decision.kind).toBe("next");
  });

  it("prefers next question closest to current posterior mean (pickPoolSize=1)", () => {
    const answers: CatAnswer[] = [
      { difficulty: 5, scoreRatio: 1 },
      { difficulty: 6, scoreRatio: 1 },
      { difficulty: 7, scoreRatio: 1 },
    ];
    const candidates: CatCandidateQuestion[] = [
      { id: "far-low", difficulty: 1 },
      { id: "on-target", difficulty: 7 },
      { id: "far-high", difficulty: 10 },
    ];
    const decision = decideNext(answers, candidates, { pickPoolSize: 1 });
    expect(decision.kind).toBe("next");
    if (decision.kind !== "next") throw new Error();
    expect(decision.questionId).toBe("on-target");
  });

  it("spreads picks across the top-K by information for item-exposure control", () => {
    // Prior mean starts at 5. Three items sit equidistant around it;
    // one item is far away. Top-3 should be the three near items;
    // the far item should never be picked.
    const candidates: CatCandidateQuestion[] = [
      { id: "near-4", difficulty: 4 },
      { id: "near-5", difficulty: 5 },
      { id: "near-6", difficulty: 6 },
      { id: "far", difficulty: 10 },
    ];
    const picks = new Set<string>();
    // Deterministic RNG: cycle through fractional values so all three
    // top-K positions get hit.
    const seq = [0.01, 0.4, 0.7];
    for (const r of seq) {
      const decision = decideNext([], candidates, {
        pickPoolSize: 3,
        random: () => r,
      });
      if (decision.kind !== "next") throw new Error();
      picks.add(decision.questionId);
    }
    expect(picks.has("far")).toBe(false);
    expect(picks.size).toBeGreaterThanOrEqual(2);
  });

  it("default pickPoolSize is >1 so identical states don't always pick the same question", () => {
    const candidates: CatCandidateQuestion[] = [
      { id: "a", difficulty: 5 },
      { id: "b", difficulty: 5 },
      { id: "c", difficulty: 5 },
    ];
    const seen = new Set<string>();
    for (const r of [0, 0.34, 0.67]) {
      const decision = decideNext([], candidates, { random: () => r });
      if (decision.kind !== "next") throw new Error();
      seen.add(decision.questionId);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("ends when the pool is exhausted", () => {
    const answers: CatAnswer[] = [
      { difficulty: 5, scoreRatio: 1 },
      { difficulty: 5, scoreRatio: 1 },
    ];
    const decision = decideNext(answers, []);
    expect(decision.kind).toBe("end");
    if (decision.kind !== "end") throw new Error();
    expect(decision.reason).toBe("no_more_questions");
  });

  it("anchors the prior at 3/5/7 for junior/mid/senior", () => {
    expect(priorMeanForBand("junior")).toBe(3);
    expect(priorMeanForBand("mid")).toBe(5);
    expect(priorMeanForBand("senior")).toBe(7);
    expect(priorMeanForBand(null)).toBe(5);
    expect(priorMeanForBand(undefined)).toBe(5);
  });

  it("terminates faster for a senior candidate who answers well when the prior is set", () => {
    const scoreForDifficulty = (d: number) => (d <= 7 ? 1 : 0.3);
    // Same run twice: once with default prior (mean 5), once anchored
    // at senior (mean 7). The senior-anchored run should reach the
    // confidence threshold in strictly fewer or equal questions.
    const runWith = (band?: "senior") => {
      const answers: CatAnswer[] = [];
      let remaining = pool();
      for (let step = 0; step < 40; step++) {
        const decision = decideNext(answers, remaining, {
          claimedBand: band ?? null,
        });
        if (decision.kind === "end") return answers.length;
        const q = remaining.find((c) => c.id === decision.questionId)!;
        answers.push({
          difficulty: q.difficulty,
          scoreRatio: scoreForDifficulty(q.difficulty),
        });
        remaining = remaining.filter((c) => c.id !== q.id);
      }
      throw new Error("never terminated");
    };
    const withoutPrior = runWith();
    const withSeniorPrior = runWith("senior");
    expect(withSeniorPrior).toBeLessThanOrEqual(withoutPrior);
  });

  it("respects the per-skill exposure cap so one skill can't dominate", () => {
    // Six items, two skills, three per skill. Cap at 2 per skill.
    const candidates: CatCandidateQuestion[] = [
      { id: "a1", difficulty: 5, skillId: "A" },
      { id: "a2", difficulty: 5, skillId: "A" },
      { id: "a3", difficulty: 5, skillId: "A" },
      { id: "b1", difficulty: 5, skillId: "B" },
      { id: "b2", difficulty: 5, skillId: "B" },
      { id: "b3", difficulty: 5, skillId: "B" },
    ];
    const answers: CatAnswer[] = [
      { difficulty: 5, scoreRatio: 1, skillId: "A" },
      { difficulty: 5, scoreRatio: 1, skillId: "A" },
    ];
    const decision = decideNext(
      answers,
      candidates.filter((c) => c.id !== "a1" && c.id !== "a2"),
      { maxPerSkill: 2 },
    );
    expect(decision.kind).toBe("next");
    if (decision.kind !== "next") throw new Error();
    // Skill A already has 2 answers; picker must go to skill B.
    const picked = candidates.find((c) => c.id === decision.questionId);
    expect(picked?.skillId).toBe("B");
  });

  it("falls back to the full pool when every candidate exceeds the cap", () => {
    const candidates: CatCandidateQuestion[] = [
      { id: "a3", difficulty: 5, skillId: "A" },
    ];
    const answers: CatAnswer[] = [
      { difficulty: 5, scoreRatio: 1, skillId: "A" },
      { difficulty: 5, scoreRatio: 1, skillId: "A" },
    ];
    const decision = decideNext(answers, candidates, { maxPerSkill: 2 });
    // Cap technically excludes a3 (skill A already at 2), but the
    // fallback preserves it rather than terminating early. Answers
    // length (2) is below MIN_QUESTIONS so the picker still runs.
    expect(decision.kind).toBe("next");
    if (decision.kind !== "next") throw new Error();
    expect(decision.questionId).toBe("a3");
  });
});
