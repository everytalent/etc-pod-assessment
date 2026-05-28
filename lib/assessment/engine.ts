/**
 * Assessment engine — PRD §5.3.
 *
 * Pure layer (unit-tested):
 *   evaluateCondition  — single condition vs. running response state
 *   evaluateBranching  — apply rules in priority order; first match wins
 *   pickNextQuestion   — combine branching action + order_index fallback
 *   detectCycles       — static rule-graph cycle check (admin guard)
 *
 * DB-bound layer (covered by /api integration once that lands):
 *   getNextQuestion(responseId)   — load state, evaluate, return next id
 *   finalizeResponse(responseId)  — sum scores, compute pass, persist
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  type Answer,
  answers,
  type BranchingRule,
  branchingRules,
  type Question,
  questions,
  type Response,
  responses,
  type ResponseMetadata,
  type RuleAction,
  type RuleCondition,
  assessments,
} from "@/lib/db/schema";

import { computeResponseFinalScore } from "./scoring";

/* ---------- Pure layer ---------- */

export type EvaluationContext = {
  /** Sum of score_awarded across all answers so far. */
  runningScore: number;
  /** Per-section sum of score_awarded. */
  sectionScores: Readonly<Record<string, number>>;
  /** Selected option ids on the question whose rules we're evaluating. */
  lastSelectedOptions: readonly string[];
};

export function evaluateCondition(
  condition: RuleCondition,
  ctx: EvaluationContext,
): boolean {
  switch (condition.op) {
    case "score_gte":
      return ctx.runningScore >= condition.value;
    case "score_lte":
      return ctx.runningScore <= condition.value;
    case "answer_equals":
      return ctx.lastSelectedOptions.includes(condition.value);
    case "answer_in":
      return ctx.lastSelectedOptions.some((s) => condition.value.includes(s));
    case "section_score_gte":
      return (ctx.sectionScores[condition.section] ?? 0) >= condition.value;
  }
}

/**
 * Evaluate rules attached to the current question in ascending priority order.
 * Returns the first matching action, or null if none match.
 */
export function evaluateBranching(
  rules: readonly Pick<BranchingRule, "condition" | "action" | "priority">[],
  ctx: EvaluationContext,
): RuleAction | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (evaluateCondition(rule.condition, ctx)) {
      return rule.action;
    }
  }
  return null;
}

export type NextQuestionResult =
  | { kind: "next"; questionId: string }
  | { kind: "end" };

/**
 * Combine a branching action (or null) with the order_index fallback.
 * Pure — pass in pre-loaded questions.
 */
export function pickNextQuestion(args: {
  questions: readonly Pick<Question, "id" | "orderIndex" | "section">[];
  currentQuestionId: string;
  branchingAction: RuleAction | null;
}): NextQuestionResult {
  const ordered = [...args.questions].sort((a, b) => a.orderIndex - b.orderIndex);
  const currentIdx = ordered.findIndex((q) => q.id === args.currentQuestionId);

  const action = args.branchingAction;
  if (action) {
    switch (action.type) {
      case "skip_to_end":
        return { kind: "end" };
      case "jump_to": {
        const target = ordered.find((q) => q.id === action.target_question_id);
        return target
          ? { kind: "next", questionId: target.id }
          : { kind: "end" };
      }
      case "skip_section": {
        if (currentIdx === -1) return { kind: "end" };
        const skipped = action.section;
        const next = ordered.find(
          (q, i) => i > currentIdx && q.section !== skipped,
        );
        return next ? { kind: "next", questionId: next.id } : { kind: "end" };
      }
    }
  }

  // Default: next by order_index.
  if (currentIdx === -1 || currentIdx >= ordered.length - 1) {
    return { kind: "end" };
  }
  return { kind: "next", questionId: ordered[currentIdx + 1]!.id };
}

/**
 * Static cycle detection over the question DAG, used by the admin builder
 * before saving a rule (PRD §9). Treats each `jump_to` as a directed edge
 * and the implicit order_index → order_index+1 fall-through as another edge.
 *
 * Returns each cycle path it finds. An empty array means the graph is acyclic.
 *
 * NOTE: this is a structural check. A "cycle" here is a chain that *could*
 * loop given the right runtime conditions; it doesn't mean every traversal
 * will loop. Combined with the runtime visited-set guard in getNextQuestion,
 * it prevents infinite sessions.
 */
export function detectCycles(
  questions: readonly Pick<Question, "id" | "orderIndex">[],
  rules: readonly Pick<BranchingRule, "fromQuestionId" | "action">[],
): string[][] {
  const ordered = [...questions].sort((a, b) => a.orderIndex - b.orderIndex);
  const idToIdx = new Map(ordered.map((q, i) => [q.id, i] as const));
  const cycles: string[][] = [];

  for (const start of ordered) {
    const stack: { id: string; path: string[] }[] = [
      { id: start.id, path: [start.id] },
    ];
    const visited = new Set<string>([start.id]);

    while (stack.length > 0) {
      const node = stack.pop()!;
      const edges: string[] = [];

      const idx = idToIdx.get(node.id);
      if (idx !== undefined && idx < ordered.length - 1) {
        edges.push(ordered[idx + 1]!.id);
      }
      for (const r of rules) {
        if (r.fromQuestionId !== node.id) continue;
        if (r.action.type === "jump_to") {
          edges.push(r.action.target_question_id);
        }
        // skip_to_end terminates; skip_section moves forward by definition.
      }

      for (const next of edges) {
        if (next === start.id) {
          cycles.push([...node.path, next]);
          continue;
        }
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push({ id: next, path: [...node.path, next] });
      }
    }
  }

  return cycles;
}

/* ---------- DB-bound layer ---------- */

export type SessionContext = {
  response: Response;
  answeredQuestions: Question[];
  unansweredQuestions: Question[];
  /** All answers for this response, ordered by answeredAt asc. */
  answers: Answer[];
};

async function loadSessionContext(responseId: string): Promise<SessionContext> {
  const [response] = await db
    .select()
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!response) throw new Error(`response ${responseId} not found`);

  const allQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.assessmentId, response.assessmentId));

  const responseAnswers = await db
    .select()
    .from(answers)
    .where(eq(answers.responseId, responseId));

  const answeredIds = new Set(responseAnswers.map((a) => a.questionId));
  return {
    response,
    answers: responseAnswers.sort(
      (a, b) => a.answeredAt.getTime() - b.answeredAt.getTime(),
    ),
    answeredQuestions: allQuestions.filter((q) => answeredIds.has(q.id)),
    unansweredQuestions: allQuestions.filter((q) => !answeredIds.has(q.id)),
  };
}

/**
 * Determine the next question for a response.
 *
 * If there are no answers yet, returns the question with the lowest
 * order_index. Otherwise, evaluates the branching rules attached to the
 * most recently answered question and either follows the matched action
 * or falls back to order_index + 1.
 *
 * The runtime visited-set guard prevents infinite loops even if the static
 * cycle check missed something — if the chosen next question has already
 * been answered, we end the assessment.
 */
export async function getNextQuestion(
  responseId: string,
): Promise<NextQuestionResult> {
  const ctx = await loadSessionContext(responseId);

  const allQuestions = [
    ...ctx.answeredQuestions,
    ...ctx.unansweredQuestions,
  ].sort((a, b) => a.orderIndex - b.orderIndex);

  if (ctx.answers.length === 0) {
    const first = allQuestions[0];
    return first ? { kind: "next", questionId: first.id } : { kind: "end" };
  }

  const lastAnswer = ctx.answers[ctx.answers.length - 1]!;
  const lastQuestion = allQuestions.find((q) => q.id === lastAnswer.questionId);
  if (!lastQuestion) return { kind: "end" };

  const sectionScores: Record<string, number> = {};
  let runningScore = 0;
  for (const a of ctx.answers) {
    runningScore += a.scoreAwarded;
    const q = allQuestions.find((qq) => qq.id === a.questionId);
    const section = q?.section;
    if (section) {
      sectionScores[section] = (sectionScores[section] ?? 0) + a.scoreAwarded;
    }
  }

  const rules = await db
    .select()
    .from(branchingRules)
    .where(eq(branchingRules.fromQuestionId, lastQuestion.id));

  const action = evaluateBranching(rules, {
    runningScore,
    sectionScores,
    lastSelectedOptions: lastAnswer.selectedOptions,
  });

  const result = pickNextQuestion({
    questions: allQuestions,
    currentQuestionId: lastQuestion.id,
    branchingAction: action,
  });

  // Runtime cycle guard: if the chosen next is already answered, we're done.
  if (result.kind === "next") {
    const alreadyAnswered = ctx.answers.some(
      (a) => a.questionId === result.questionId,
    );
    if (alreadyAnswered) return { kind: "end" };
  }

  return result;
}

/**
 * Finalize a response — compute total score, max possible score (over the
 * questions actually shown), pass/fail, and persist back to `responses`.
 *
 * Optionally stamps submit_ip_hash on metadata so the drill-in can show
 * whether the candidate's network changed between intake and submission.
 */
export async function finalizeResponse(
  responseId: string,
  submitIpHash?: string,
): Promise<{
  totalScore: number;
  maxPossibleScore: number;
  pass: boolean;
}> {
  const ctx = await loadSessionContext(responseId);
  const [assessment] = await db
    .select({
      passThreshold: assessments.passThreshold,
      mode: assessments.mode,
      specialisation: assessments.specialisation,
    })
    .from(assessments)
    .where(eq(assessments.id, ctx.response.assessmentId))
    .limit(1);
  if (!assessment) {
    throw new Error(`assessment ${ctx.response.assessmentId} not found`);
  }

  const maxPossibleScore = ctx.answeredQuestions.reduce(
    (s, q) => s + q.points,
    0,
  );
  const { totalScore, pass } = computeResponseFinalScore(
    ctx.answers.map((a) => a.scoreAwarded),
    maxPossibleScore,
    assessment.passThreshold,
  );

  const path = ctx.answers.map((a) => a.questionId);
  const metadata: ResponseMetadata = {
    ...ctx.response.metadata,
    path,
    time_on_task_seconds:
      ctx.response.metadata.time_on_task_seconds ??
      Math.floor(
        (Date.now() - ctx.response.startedAt.getTime()) / 1000,
      ),
    ...(submitIpHash ? { submit_ip_hash: submitIpHash } : {}),
  };

  await db
    .update(responses)
    .set({
      totalScore,
      maxPossibleScore,
      pass,
      status: "submitted",
      submittedAt: new Date(),
      metadata,
    })
    .where(and(eq(responses.id, responseId)));

  // Validation-mode follow-up: trigger Kimi synthesis + notify Onboarding.
  // Awaited (not fire-and-forget) so the candidate's done-screen render
  // sees a fully synthesised profile, and serverless functions don't
  // terminate mid-pipeline. ~3-8s extra latency on the submit click;
  // acceptable for MVP. Move to a queue when this exceeds 10s p95.
  if (assessment.mode === "validation") {
    await runValidationPostSubmit({
      responseId,
      assessmentSpecialisation: assessment.specialisation,
      candidateMetadata: ctx.response.metadata,
    });
  }

  return { totalScore, maxPossibleScore, pass };
}

/**
 * Validation-mode post-submit pipeline:
 *   1. Run Kimi synthesis → writes validation_results + vetted_talent_profile
 *   2. Fire the completion callback to Onboarding (popup)
 *
 * Both steps are best-effort: synthesis failures fall back to
 * requires_human_review=true; callback failures land in notify_log
 * for manual replay. The candidate's submit succeeds regardless.
 */
async function runValidationPostSubmit(args: {
  responseId: string;
  assessmentSpecialisation: string | null;
  candidateMetadata: ResponseMetadata;
}): Promise<void> {
  const meta = args.candidateMetadata as ResponseMetadata & {
    external_candidate_id?: string;
    specialisation?: string;
    claimed_band?: "junior" | "mid" | "senior";
    redirect_url_after_completion?: string;
  };
  const candidateId = meta.external_candidate_id;
  const spec = args.assessmentSpecialisation ?? meta.specialisation;
  const claimedBand = meta.claimed_band ?? "junior";
  if (!candidateId || !spec) {
    // Session was minted without the validation-flow metadata. Skip
    // synthesis; admin can run it manually via the response page later.
    return;
  }

  let synthOutcome: {
    synthesised: boolean;
    cadre?: string;
    displayLabel?: string;
  } = { synthesised: false };
  try {
    const { synthesiseResponse } = await import(
      "@/lib/engines/assessment/synthesis/kimi-synthesis"
    );
    await synthesiseResponse({
      responseId: args.responseId,
      candidateId,
      claimedBandsBySpec: { [spec]: claimedBand },
    });
    // Pull the freshly-written profile row to feed the callback summary.
    const { vettedTalentProfile } = await import("@/lib/db/schema");
    const [latest] = await db
      .select({
        cadre: vettedTalentProfile.cadre,
        displayLabel: vettedTalentProfile.displayLabel,
      })
      .from(vettedTalentProfile)
      .where(eq(vettedTalentProfile.responseId, args.responseId))
      .limit(1);
    synthOutcome = {
      synthesised: true,
      cadre: latest?.cadre,
      displayLabel: latest?.displayLabel,
    };
  } catch (err) {
    console.warn(
      "[finalizeResponse] validation synthesis failed:",
      err instanceof Error ? err.message : "unknown",
    );
    // Don't rethrow — candidate's submit must succeed even if synthesis
    // is misconfigured.
  }

  // Fire completion callback (no-await semantics not needed — the lib
  // itself retries with backoff and logs to notify_log on exhaustion).
  try {
    const { postValidationCompleted } = await import(
      "@/lib/engines/assessment/onboarding-completion-callback"
    );
    const resultUrl =
      meta.redirect_url_after_completion ??
      `${(process.env.ONBOARDING_API_URL ?? "").replace(/\/$/, "")}/candidate/profile`;
    await postValidationCompleted({
      candidate_id: candidateId,
      session_id: args.responseId,
      completed_at: new Date().toISOString(),
      per_spec_summary: [
        {
          specialisation: spec,
          cadre: synthOutcome.cadre ?? "int",
          display_label:
            synthOutcome.displayLabel ?? `Validation result for ${spec}`,
        },
      ],
      result_url: resultUrl,
    });
  } catch (err) {
    console.warn(
      "[finalizeResponse] completion callback errored:",
      err instanceof Error ? err.message : "unknown",
    );
  }
}
