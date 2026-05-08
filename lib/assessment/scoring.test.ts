import { describe, expect, it } from "vitest";

import {
  arraysEqual,
  computeResponseFinalScore,
  isCorrectAnswer,
  scoreAnswer,
} from "./scoring";

const mcq = {
  points: 5,
  negativePoints: 2,
  correctAnswer: ["b"],
  timeoutAction: "auto_submit" as const,
};

describe("arraysEqual", () => {
  it("returns true for identical arrays", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
  });
  it("returns false for different lengths", () => {
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
  });
  it("returns false for same length, different content", () => {
    expect(arraysEqual(["a", "b"], ["a", "c"])).toBe(false);
  });
});

describe("isCorrectAnswer", () => {
  it("ignores selection order", () => {
    const q = { correctAnswer: ["a", "c"] };
    expect(isCorrectAnswer(q, ["c", "a"])).toBe(true);
  });
  it("rejects partial overlap", () => {
    const q = { correctAnswer: ["a", "c"] };
    expect(isCorrectAnswer(q, ["a"])).toBe(false);
  });
});

describe("scoreAnswer — normal flow", () => {
  it("awards +points for a correct MCQ", () => {
    expect(scoreAnswer(mcq, ["b"], false)).toBe(5);
  });
  it("subtracts negativePoints for an incorrect MCQ", () => {
    expect(scoreAnswer(mcq, ["a"], false)).toBe(-2);
  });
  it("treats empty selection as incorrect", () => {
    expect(scoreAnswer(mcq, [], false)).toBe(-2);
  });
});

describe("scoreAnswer — timeout actions", () => {
  it("auto_submit: falls through to normal scoring (correct)", () => {
    const q = { ...mcq, timeoutAction: "auto_submit" as const };
    expect(scoreAnswer(q, ["b"], true)).toBe(5);
  });
  it("auto_submit: falls through to normal scoring (incorrect)", () => {
    const q = { ...mcq, timeoutAction: "auto_submit" as const };
    expect(scoreAnswer(q, ["a"], true)).toBe(-2);
  });
  it("skip: returns 0 regardless of selection", () => {
    const q = { ...mcq, timeoutAction: "skip" as const };
    expect(scoreAnswer(q, ["b"], true)).toBe(0);
    expect(scoreAnswer(q, [], true)).toBe(0);
  });
  it("mark_incorrect: subtracts negativePoints", () => {
    const q = { ...mcq, timeoutAction: "mark_incorrect" as const };
    expect(scoreAnswer(q, ["b"], true)).toBe(-2);
    expect(scoreAnswer(q, [], true)).toBe(-2);
  });
});

describe("computeResponseFinalScore", () => {
  it("sums awarded scores and applies pass threshold", () => {
    const result = computeResponseFinalScore([5, -2, 6, 4], 20, 70);
    expect(result.totalScore).toBe(13);
    expect(result.pass).toBe(false);
  });
  it("passes when ratio meets threshold", () => {
    const result = computeResponseFinalScore([5, 5, 4], 20, 70);
    expect(result.totalScore).toBe(14);
    expect(result.pass).toBe(true);
  });
  it("returns pass=false when maxPossibleScore is 0", () => {
    const result = computeResponseFinalScore([], 0, 70);
    expect(result.totalScore).toBe(0);
    expect(result.pass).toBe(false);
  });
});
