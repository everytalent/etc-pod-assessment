import { describe, expect, it } from "vitest";

import {
  decideNext,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
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

  it("prefers next question closest to current posterior mean", () => {
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
    const decision = decideNext(answers, candidates);
    expect(decision.kind).toBe("next");
    if (decision.kind !== "next") throw new Error();
    expect(decision.questionId).toBe("on-target");
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
});
