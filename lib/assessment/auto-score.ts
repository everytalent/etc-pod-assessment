/**
 * AI scoring that runs by itself.
 *
 * A submitted response used to wait for a reviewer to open it and press
 * "Run AI scoring". Now it is scored the moment the candidate submits
 * (the finalize route hands it here after replying) and swept up by the
 * every-minute background worker for anything that could not finish in
 * one go: long assessments, a provider that was down, a key that was
 * missing. Everything is time-budgeted because Netlify cuts functions off.
 */

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { responses } from "@/lib/db/schema";

import { finalizeConsensus, planForResponse, scoreAnswerWithProvider } from "./ai-cross-check";

/** Give up on a provider for a response after this many sweeps of trying. */
const MAX_PASSES = 4;
/** Do not start a scoring call with less than this much budget left. */
const MIN_CALL_BUDGET_MS = 8_000;

type AutoMeta = { ai_auto_passes?: number; ai_auto_errors?: string[] };

export type AutoScoreOutcome = {
  responseId: string;
  scored: number;
  failed: number;
  remaining: number;
  finalized: boolean;
  errors: string[];
};

export async function autoScoreResponse(responseId: string, budgetMs: number): Promise<AutoScoreOutcome> {
  const startedAt = Date.now();
  const left = () => budgetMs - (Date.now() - startedAt);
  const out: AutoScoreOutcome = { responseId, scored: 0, failed: 0, remaining: 0, finalized: false, errors: [] };

  const [row] = await db
    .select({ status: responses.status, metadata: responses.metadata, ranAt: responses.aiPipelineRanAt })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  if (!row || row.status !== "submitted") return out;

  const plan = await planForResponse(responseId);
  const todo: { answerId: string; provider: "gemini" | "kimi" }[] = [];
  for (const s of plan.scorable) {
    if (!plan.existing.gemini.includes(s.answerId)) todo.push({ answerId: s.answerId, provider: "gemini" });
    if (!plan.existing.kimi.includes(s.answerId)) todo.push({ answerId: s.answerId, provider: "kimi" });
  }

  const meta = (row.metadata ?? {}) as AutoMeta;
  const passes = (meta.ai_auto_passes ?? 0) + 1;

  // A provider refusing outright (no key, no credit, quota) fails the same
  // way for every answer, so after one such refusal the rest of its steps
  // wait for the next pass instead of burning the budget on repeats.
  const dead = new Set<"gemini" | "kimi">();
  for (const step of todo) {
    if (dead.has(step.provider) || left() < MIN_CALL_BUDGET_MS) {
      out.remaining += 1;
      continue;
    }
    try {
      await scoreAnswerWithProvider(step.answerId, step.provider);
      out.scored += 1;
    } catch (err) {
      out.failed += 1;
      const msg = err instanceof Error ? err.message : "unknown";
      out.errors.push(`${step.provider} ${step.answerId.slice(0, 8)}: ${msg.slice(0, 160)}`);
      if (/not set|invalid or revoked|out of credit|quota|rate limit/i.test(msg)) dead.add(step.provider);
    }
  }

  const everythingScored = out.remaining === 0 && out.failed === 0;
  const giveUp = passes >= MAX_PASSES;
  const nothingToDo = todo.length === 0;
  if (nothingToDo || everythingScored || giveUp) {
    if (!row.ranAt || out.scored > 0 || nothingToDo) await finalizeConsensus(responseId);
    out.finalized = true;
  }

  const nextMeta: AutoMeta & Record<string, unknown> = {
    ...(row.metadata as Record<string, unknown> | null ?? {}),
    ai_auto_passes: passes,
    ...(out.errors.length ? { ai_auto_errors: out.errors.slice(0, 10) } : {}),
  };
  await db.update(responses).set({ metadata: nextMeta as typeof responses.$inferInsert.metadata }).where(eq(responses.id, responseId));

  console.info(
    `[auto-score] ${responseId.slice(0, 8)} pass ${passes}: scored ${out.scored}, failed ${out.failed}, remaining ${out.remaining}${out.finalized ? ", finalized" : ""}`,
  );
  return out;
}

/**
 * Submitted responses nobody has scored yet, oldest first, within a budget.
 * A response is "done" once ai_pipeline_ran_at is stamped, which happens
 * when everything scorable has both scores or the passes ran out.
 */
export async function autoScorePending(budgetMs: number, limit = 10): Promise<AutoScoreOutcome[]> {
  const startedAt = Date.now();
  const rows = await db
    .select({ id: responses.id })
    .from(responses)
    .where(and(eq(responses.status, "submitted"), isNull(responses.aiPipelineRanAt)))
    .orderBy(asc(responses.submittedAt))
    .limit(limit);
  const outcomes: AutoScoreOutcome[] = [];
  for (const r of rows) {
    const left = budgetMs - (Date.now() - startedAt);
    if (left < MIN_CALL_BUDGET_MS) break;
    try {
      outcomes.push(await autoScoreResponse(r.id, left));
    } catch (err) {
      console.warn(`[auto-score] ${r.id.slice(0, 8)} threw: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
  return outcomes;
}
