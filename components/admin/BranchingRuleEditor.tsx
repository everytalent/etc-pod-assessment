"use client";

/**
 * Per-question branching rule editor.
 *
 * Lists existing rules attached to `fromQuestion`, lets the admin add a new
 * one (operator + action dropdowns), and handles delete. Server enforces
 * cycle detection — if the response is `cycle_detected`, we surface the
 * paths that would loop so the admin can see exactly why.
 */

import { useState } from "react";

import type {
  BranchingRule,
  Question,
  RuleAction,
  RuleCondition,
} from "@/lib/db/schema";

type Props = {
  assessmentId: string;
  fromQuestion: Pick<Question, "id" | "section">;
  questions: Pick<Question, "id" | "orderIndex" | "questionText" | "section">[];
  rules: BranchingRule[];
  allRules: BranchingRule[];
  onRulesChanged: (next: BranchingRule[]) => void;
};

type Op = RuleCondition["op"];
type ActionType = RuleAction["type"];

const OPS: { value: Op; label: string }[] = [
  { value: "score_gte", label: "Running score ≥" },
  { value: "score_lte", label: "Running score ≤" },
  { value: "answer_equals", label: "Last answer is" },
  { value: "answer_in", label: "Last answer in" },
  { value: "section_score_gte", label: "Section score ≥" },
];

const ACTIONS: { value: ActionType; label: string }[] = [
  { value: "jump_to", label: "Jump to question" },
  { value: "skip_to_end", label: "Skip to end" },
  { value: "skip_section", label: "Skip section" },
];

export function BranchingRuleEditor({
  assessmentId,
  fromQuestion,
  questions,
  rules,
  allRules,
  onRulesChanged,
}: Props) {
  const [op, setOp] = useState<Op>("score_gte");
  const [conditionValue, setConditionValue] = useState<string>("70");
  const [conditionSection, setConditionSection] = useState("");
  const [actionType, setActionType] = useState<ActionType>("jump_to");
  const [targetQuestionId, setTargetQuestionId] = useState<string>("");
  const [actionSection, setActionSection] = useState("");
  const [priority, setPriority] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sections = Array.from(
    new Set(
      questions
        .map((q) => q.section)
        .filter((s): s is string => Boolean(s)),
    ),
  );

  const buildCondition = (): RuleCondition | null => {
    const num = Number(conditionValue);
    switch (op) {
      case "score_gte":
      case "score_lte":
        if (Number.isNaN(num)) return null;
        return { op, value: num };
      case "answer_equals":
        return conditionValue.trim()
          ? { op, value: conditionValue.trim() }
          : null;
      case "answer_in":
        return {
          op,
          value: conditionValue
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      case "section_score_gte":
        if (Number.isNaN(num) || !conditionSection) return null;
        return { op, section: conditionSection, value: num };
    }
  };

  const buildAction = (): RuleAction | null => {
    switch (actionType) {
      case "jump_to":
        return targetQuestionId ? { type: actionType, target_question_id: targetQuestionId } : null;
      case "skip_to_end":
        return { type: actionType };
      case "skip_section":
        return actionSection
          ? { type: actionType, section: actionSection }
          : null;
    }
  };

  const onAdd = async () => {
    const condition = buildCondition();
    const action = buildAction();
    if (!condition || !action) {
      setError("Fill in the operator value and action target.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/branching-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          fromQuestionId: fromQuestion.id,
          condition,
          action,
          priority,
        }),
      });
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          cycles?: string[][];
        };
        if (data.error === "cycle_detected" && data.cycles?.length) {
          setError(
            `This rule creates a cycle: ${data.cycles[0]!.join(" → ")}. Adjust order or target.`,
          );
          return;
        }
        setError(data.error ?? "Invalid rule");
        return;
      }
      if (!res.ok) {
        throw new Error(`Save failed (${res.status})`);
      }
      const data = (await res.json()) as { rule: BranchingRule };
      onRulesChanged([...allRules, data.rule]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    const res = await fetch(`/api/admin/branching-rules/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      alert(`Delete failed: ${res.status}`);
      return;
    }
    onRulesChanged(allRules.filter((r) => r.id !== id));
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      {rules.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {rules
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2"
              >
                <span>
                  <span className="font-mono text-muted-foreground">
                    [p{r.priority}]
                  </span>{" "}
                  IF {summariseCondition(r.condition)} → {summariseAction(r.action, questions)}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(r.id)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 text-[0.65rem] text-destructive hover:border-destructive"
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-[0.7rem] text-muted-foreground">
          No rules yet. Default: advance to the next question by order.
        </p>
      )}

      <div className="rounded-lg border border-dashed border-border bg-background/40 p-3">
        <p className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Add a rule
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select
            aria-label="Condition operator"
            value={op}
            onChange={(e) => setOp(e.target.value as Op)}
            className={selectClass}
          >
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {op === "section_score_gte" ? (
            <div className="flex gap-2">
              <select
                aria-label="Condition section"
                value={conditionSection}
                onChange={(e) => setConditionSection(e.target.value)}
                className={selectClass}
              >
                <option value="">Section…</option>
                {sections.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={conditionValue}
                onChange={(e) => setConditionValue(e.target.value)}
                className={inputClass}
                placeholder="value"
              />
            </div>
          ) : (
            <input
              type="text"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              className={inputClass}
              placeholder={
                op === "answer_in"
                  ? "comma-separated option ids"
                  : op.startsWith("score") ? "number" : "value"
              }
            />
          )}

          <select
            aria-label="Action type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
            className={selectClass}
          >
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {actionType === "jump_to" && (
            <select
              aria-label="Target question"
              value={targetQuestionId}
              onChange={(e) => setTargetQuestionId(e.target.value)}
              className={selectClass}
            >
              <option value="">Target question…</option>
              {questions.map((q) => (
                <option key={q.id} value={q.id}>
                  #{q.orderIndex + 1} · {q.questionText.slice(0, 50)}
                </option>
              ))}
            </select>
          )}
          {actionType === "skip_section" && (
            <select
              aria-label="Section to skip"
              value={actionSection}
              onChange={(e) => setActionSection(e.target.value)}
              className={selectClass}
            >
              <option value="">Section to skip…</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className={inputClass}
            placeholder="Priority (lower = first)"
          />
        </div>

        {error && (
          <p className="mt-2 rounded border border-destructive bg-destructive/10 p-2 text-[0.7rem] text-destructive">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void onAdd()}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[0.7rem] font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Adding…" : "Add rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-xs focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-etc-marigold";
const selectClass = inputClass;

function summariseCondition(c: RuleCondition): string {
  switch (c.op) {
    case "score_gte":
      return `score ≥ ${c.value}`;
    case "score_lte":
      return `score ≤ ${c.value}`;
    case "answer_equals":
      return `answer = "${c.value}"`;
    case "answer_in":
      return `answer ∈ {${c.value.join(", ")}}`;
    case "section_score_gte":
      return `section[${c.section}] ≥ ${c.value}`;
  }
}

function summariseAction(
  a: RuleAction,
  questions: Pick<Question, "id" | "orderIndex" | "questionText">[],
): string {
  switch (a.type) {
    case "jump_to": {
      const q = questions.find((qq) => qq.id === a.target_question_id);
      return q
        ? `jump to #${q.orderIndex + 1}`
        : `jump to ${a.target_question_id.slice(0, 8)}`;
    }
    case "skip_to_end":
      return "skip to end";
    case "skip_section":
      return `skip section "${a.section}"`;
  }
}
