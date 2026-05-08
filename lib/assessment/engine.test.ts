import { describe, expect, it } from "vitest";

import {
  detectCycles,
  evaluateBranching,
  evaluateCondition,
  pickNextQuestion,
} from "./engine";
import type {
  BranchingRule,
  Question,
  RuleAction,
  RuleCondition,
} from "@/lib/db/schema";

type Q = Pick<Question, "id" | "orderIndex" | "section">;
type R = Pick<BranchingRule, "fromQuestionId" | "action" | "condition" | "priority">;

const qs: Q[] = [
  { id: "q1", orderIndex: 0, section: "fundamentals" },
  { id: "q2", orderIndex: 1, section: "safety" },
  { id: "q3", orderIndex: 2, section: "safety" },
  { id: "q4", orderIndex: 3, section: "advanced" },
  { id: "q5", orderIndex: 4, section: "advanced" },
];

describe("evaluateCondition", () => {
  const baseCtx = {
    runningScore: 50,
    sectionScores: { safety: 12, fundamentals: 10 },
    lastSelectedOptions: ["b"],
  };

  it("score_gte: matches when running >= threshold", () => {
    expect(evaluateCondition({ op: "score_gte", value: 50 }, baseCtx)).toBe(true);
    expect(evaluateCondition({ op: "score_gte", value: 51 }, baseCtx)).toBe(false);
  });
  it("score_lte: matches when running <= threshold", () => {
    expect(evaluateCondition({ op: "score_lte", value: 50 }, baseCtx)).toBe(true);
    expect(evaluateCondition({ op: "score_lte", value: 49 }, baseCtx)).toBe(false);
  });
  it("answer_equals: matches when option present in selection", () => {
    expect(evaluateCondition({ op: "answer_equals", value: "b" }, baseCtx)).toBe(true);
    expect(evaluateCondition({ op: "answer_equals", value: "c" }, baseCtx)).toBe(false);
  });
  it("answer_in: matches if any selected is in the list", () => {
    const cond: RuleCondition = { op: "answer_in", value: ["x", "b"] };
    expect(evaluateCondition(cond, baseCtx)).toBe(true);
  });
  it("section_score_gte: reads the named section bucket", () => {
    expect(
      evaluateCondition({ op: "section_score_gte", section: "safety", value: 10 }, baseCtx),
    ).toBe(true);
    expect(
      evaluateCondition({ op: "section_score_gte", section: "missing", value: 1 }, baseCtx),
    ).toBe(false);
  });
});

describe("evaluateBranching", () => {
  const rules: R[] = [
    {
      fromQuestionId: "q2",
      condition: { op: "score_gte", value: 100 },
      action: { type: "skip_to_end" },
      priority: 1,
    },
    {
      fromQuestionId: "q2",
      condition: { op: "answer_equals", value: "d" },
      action: { type: "skip_to_end" },
      priority: 2,
    },
    {
      fromQuestionId: "q2",
      condition: { op: "score_gte", value: 20 },
      action: { type: "jump_to", target_question_id: "q5" },
      priority: 3,
    },
  ];

  it("score-based rule fires", () => {
    const action = evaluateBranching(rules, {
      runningScore: 30,
      sectionScores: {},
      lastSelectedOptions: ["a"],
    });
    expect(action).toEqual({ type: "jump_to", target_question_id: "q5" });
  });

  it("answer-based rule fires", () => {
    const action = evaluateBranching(rules, {
      runningScore: 0,
      sectionScores: {},
      lastSelectedOptions: ["d"],
    });
    expect(action).toEqual({ type: "skip_to_end" });
  });

  it("priority order respected (lower priority wins)", () => {
    // Both score_gte:100 (priority 1) and score_gte:20 (priority 3) match
    // when running=150. Priority 1 wins.
    const action = evaluateBranching(rules, {
      runningScore: 150,
      sectionScores: {},
      lastSelectedOptions: ["a"],
    });
    expect(action).toEqual({ type: "skip_to_end" });
  });

  it("returns null when no rule matches", () => {
    const action = evaluateBranching(rules, {
      runningScore: 5,
      sectionScores: {},
      lastSelectedOptions: ["a"],
    });
    expect(action).toBeNull();
  });
});

describe("pickNextQuestion", () => {
  it("falls back to order_index + 1 when no action", () => {
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q2",
      branchingAction: null,
    });
    expect(result).toEqual({ kind: "next", questionId: "q3" });
  });

  it("ends the assessment when at the last question", () => {
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q5",
      branchingAction: null,
    });
    expect(result).toEqual({ kind: "end" });
  });

  it("skip_to_end ends immediately", () => {
    const action: RuleAction = { type: "skip_to_end" };
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q1",
      branchingAction: action,
    });
    expect(result).toEqual({ kind: "end" });
  });

  it("jump_to lands on the target", () => {
    const action: RuleAction = { type: "jump_to", target_question_id: "q4" };
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q1",
      branchingAction: action,
    });
    expect(result).toEqual({ kind: "next", questionId: "q4" });
  });

  it("jump_to ends if target id doesn't exist", () => {
    const action: RuleAction = { type: "jump_to", target_question_id: "missing" };
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q1",
      branchingAction: action,
    });
    expect(result).toEqual({ kind: "end" });
  });

  it("skip_section advances past all questions in that section", () => {
    const action: RuleAction = { type: "skip_section", section: "safety" };
    const result = pickNextQuestion({
      questions: qs,
      currentQuestionId: "q1",
      branchingAction: action,
    });
    // q2 and q3 are 'safety' — first non-safety after q1 is q4.
    expect(result).toEqual({ kind: "next", questionId: "q4" });
  });
});

describe("detectCycles", () => {
  it("returns no cycles for the default order_index chain", () => {
    expect(detectCycles(qs, [])).toEqual([]);
  });

  it("detects a self-loop via jump_to", () => {
    const rules: R[] = [
      {
        fromQuestionId: "q3",
        condition: { op: "score_gte", value: 0 },
        action: { type: "jump_to", target_question_id: "q1" },
        priority: 1,
      },
    ];
    const cycles = detectCycles(qs, rules);
    expect(cycles.length).toBeGreaterThan(0);
    // Each cycle path must end where it started.
    for (const cycle of cycles) {
      expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    }
  });

  it("detects a multi-hop cycle", () => {
    // q4 jumps back to q2, creating q2 → q3 → q4 → q2.
    const rules: R[] = [
      {
        fromQuestionId: "q4",
        condition: { op: "score_gte", value: 0 },
        action: { type: "jump_to", target_question_id: "q2" },
        priority: 1,
      },
    ];
    const cycles = detectCycles(qs, rules);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("returns no cycles for a forward-only jump_to", () => {
    const rules: R[] = [
      {
        fromQuestionId: "q1",
        condition: { op: "score_gte", value: 0 },
        action: { type: "jump_to", target_question_id: "q4" },
        priority: 1,
      },
    ];
    expect(detectCycles(qs, rules)).toEqual([]);
  });
});
