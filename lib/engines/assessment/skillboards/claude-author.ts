/**
 * Claude authoring orchestration for skillboards.
 *
 * Two passes (see prompts.ts):
 *   1. STRUCTURE — synchronous in the create route; returns skills/tasks/
 *      mindsets/behavioural_skills. Seeds the empty 15-cell grids.
 *   2. TASK CELLS — queued per-task. A worker pulls one job at a time
 *      from `skillboard_authoring_jobs` and runs the Opus call. The
 *      admin UI polls a status endpoint to render progress.
 *
 * Plus a CELL REGENERATION pass triggered when a reviewer rejects one
 * cell — single Opus call with the rejection notes in the prompt.
 *
 * All Opus calls go through `withOpusBudget()` (Phase 0). Every call
 * row in `ai_spend_ledger` references the purpose enum so the spend
 * dashboard can break out skillboard authoring vs question seeding.
 *
 * Web search: enabled via Anthropic's built-in `web_search_20250305`
 * tool. Opus uses it sparingly — only when it doesn't already know the
 * answer (per the system prompt rule).
 */

import { and, asc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { callOpusRaw, withOpusBudget } from "@/lib/ai/opus";
import { db } from "@/lib/db/client";
import {
  levelExpectations,
  skillboardAuthoringJobs,
  skillboards,
  skills,
  tasks,
  type AuthoringJobType,
  type PerformanceLevel,
  type SeniorityBand,
  type Skillboard,
} from "@/lib/db/schema";
import { notify } from "@/lib/notify";

import {
  buildCellRegenPrompt,
  buildStructurePrompt,
  buildTaskCellsPrompt,
  type CellRegenPromptArgs,
  type StructurePromptArgs,
  type TaskCellsPromptArgs,
} from "./prompts";
import {
  seedSkillsTasksAndEmptyCells,
  setExpectationText,
  type SkillSeed,
} from "./repository";

/* ---------- Web search tool wiring ---------- */

/**
 * Anthropic-hosted web search tool. Opus calls it during structure
 * authoring to verify current standards/brands; per the system prompt,
 * usage is sparing. Returns server-side results — no API key needed
 * beyond the Anthropic one.
 *
 * Tool name + version are pinned so a provider-side change doesn't
 * silently alter behaviour.
 */
const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 3,
} as const;

/* ---------- Output schemas (parse Opus responses) ---------- */

/**
 * Hard bounds enforced by the parser. We use a slightly wider range
 * (20-32) than the prompt's target (22-30) so a one-off drift doesn't
 * fail the whole structure pass. If Opus lands inside 20-32 we accept;
 * outside that, we retry once with explicit feedback.
 */
const TASK_COUNT_MIN = 20;
const TASK_COUNT_MAX = 32;

const structureOutputSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(3).max(60),
        tasks: z
          .array(
            z.object({
              name: z.string().trim().min(5).max(160),
            }),
          )
          .min(3)
          .max(5),
      }),
    )
    .min(6)
    .max(8)
    .refine(
      (skills) => {
        const total = skills.reduce((sum, s) => sum + s.tasks.length, 0);
        return total >= TASK_COUNT_MIN && total <= TASK_COUNT_MAX;
      },
      {
        message: `Total task count must be ${TASK_COUNT_MIN}-${TASK_COUNT_MAX} across all skills`,
      },
    ),
  mindsets: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(40),
        description: z.string().trim().min(40).max(300),
      }),
    )
    .min(3)
    .max(6),
  behavioural_skills: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(40),
        description: z.string().trim().min(40).max(300),
      }),
    )
    .min(3)
    .max(6),
});

/**
 * Coerce Opus's band/level strings to lowercase + trimmed before enum
 * validation. Opus occasionally returns "Junior", "MID", " growing ",
 * etc. Without this, perfectly fine responses fail validation and burn
 * retries. Pure normalisation — doesn't change meaning.
 */
const lowercased = (allowed: readonly [string, ...string[]]) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(allowed),
  );

const taskCellsOutputSchema = z.object({
  cells: z
    .array(
      z.object({
        band: lowercased(["junior", "mid", "senior"]),
        level: lowercased(["below", "nh", "g", "p", "tp"]),
        expectation_text: z.string().trim().min(40).max(400),
      }),
    )
    .length(15),
});

const cellRegenOutputSchema = z.object({
  expectation_text: z.string().trim().min(40).max(400),
  change_summary: z.string().trim().min(20).max(200),
});

/* ---------- Pass 1: structure ---------- */

/**
 * Run the structure pass synchronously and seed the skillboard tree.
 * Called inside the create-skillboard route (one Opus call, ~5s, fits
 * in the request timeout).
 *
 * After this returns, every task has 15 EMPTY pending cells. The route
 * handler then enqueues one `task_cells` job per task; a worker fills
 * the cells over the next few minutes.
 */
export async function runStructureAuthoring(args: {
  skillboardId: string;
  args: StructurePromptArgs;
}): Promise<{ ok: true; tasksEnqueued: number; retried: boolean }> {
  const { system, user } = buildStructurePrompt(args.args);

  const firstResult = await withOpusBudget("skillboard_authoring", () =>
    callOpusRaw({
      system,
      messages: [{ role: "user", content: user }],
      tools: [WEB_SEARCH_TOOL],
      maxTokens: 6000,
    }),
  );

  let parsed;
  let retried = false;

  try {
    parsed = parseJsonResponse(firstResult.text, structureOutputSchema);
  } catch (firstErr) {
    // Retry once with explicit feedback. Most common cause: task count
    // off by 1-2. Re-call with the assistant's first reply preserved so
    // Opus can self-correct rather than redo from scratch.
    const feedbackMessage = buildRetryFeedback(firstErr, firstResult.text);
    const secondResult = await withOpusBudget("skillboard_authoring", () =>
      callOpusRaw({
        system,
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: firstResult.text },
          { role: "user", content: feedbackMessage },
        ],
        // No tools on the retry — we're correcting structure, not
        // re-researching standards.
        maxTokens: 6000,
      }),
    );
    parsed = parseJsonResponse(secondResult.text, structureOutputSchema);
    retried = true;
  }

  // Persist mindsets + behavioural skills on the skillboard row.
  await db
    .update(skillboards)
    .set({
      mindsets: parsed.mindsets,
      behaviouralSkills: parsed.behavioural_skills,
      updatedAt: new Date(),
    })
    .where(eq(skillboards.id, args.skillboardId));

  // Seed skills + tasks + empty 15-cell grids.
  const skillSeeds: SkillSeed[] = parsed.skills.map((s, si) => ({
    name: s.name,
    orderIndex: si,
    tasks: s.tasks.map((t, ti) => ({ name: t.name, orderIndex: ti })),
  }));
  await seedSkillsTasksAndEmptyCells(args.skillboardId, skillSeeds);

  // Enqueue one `task_cells` job per task we just created.
  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, args.skillboardId))
    .orderBy(asc(skills.orderIndex), asc(tasks.orderIndex));

  if (taskRows.length > 0) {
    await db.insert(skillboardAuthoringJobs).values(
      taskRows.map((t) => ({
        skillboardId: args.skillboardId,
        jobType: "task_cells" as AuthoringJobType,
        taskId: t.id,
      })),
    );
  }

  return { ok: true, tasksEnqueued: taskRows.length, retried };
}

/**
 * Build the user-message we send Opus when the first structure response
 * failed validation. Includes the specific reason so Opus can target
 * the fix rather than re-rolling the entire output.
 */
function buildRetryFeedback(err: unknown, _firstReply: string): string {
  const message = err instanceof Error ? err.message : "unknown parse error";
  return `Your previous response failed validation:

${message}

Please return a corrected JSON object that satisfies the original constraints — same shape, same skills if they were good, but fix the specific issue above. Common fix: adjust task distribution so the total task count lands inside ${TASK_COUNT_MIN}-${TASK_COUNT_MAX}. Return ONLY the JSON, no commentary.`;
}

/* ---------- Pass 2: per-task cells (worker entry point) ---------- */

const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_JOB_ATTEMPTS = 3;

/**
 * Claim the next pending job for a skillboard and process it.
 *
 * Returns:
 *   - { processed: true, jobId } when one job ran (regardless of success)
 *   - { processed: false, reason: "no_pending_jobs" } when the queue is empty
 *
 * Idempotent: if two workers race, only one wins the claim (UPDATE … WHERE
 * status = 'pending' RETURNING).
 */
export async function processNextAuthoringJob(
  skillboardId: string,
): Promise<
  | { processed: true; jobId: string; success: boolean; error?: string }
  | { processed: false; reason: "no_pending_jobs" | "skillboard_not_found" }
> {
  // Step 1: rescue stuck jobs first (claimed > 5 min ago and still in_progress).
  await rescueStuckJobs(skillboardId);

  // Step 2: claim the oldest pending job, atomically.
  const cutoff = new Date();
  const [claimed] = await db
    .update(skillboardAuthoringJobs)
    .set({
      status: "in_progress",
      claimedAt: cutoff,
      startedAt: cutoff,
      attemptCount: sql`${skillboardAuthoringJobs.attemptCount} + 1`,
    })
    .where(
      and(
        eq(skillboardAuthoringJobs.skillboardId, skillboardId),
        eq(skillboardAuthoringJobs.status, "pending"),
        // Staged regens are not picked up until admin releases them
        // (sets paused_until_review = false via the staged-regens panel).
        eq(skillboardAuthoringJobs.pausedUntilReview, false),
      ),
    )
    .returning();

  if (!claimed) {
    return { processed: false, reason: "no_pending_jobs" };
  }

  // Step 3: dispatch by job_type.
  try {
    if (claimed.jobType === "task_cells") {
      await processTaskCellsJob(claimed.id, claimed.skillboardId, claimed.taskId);
    } else if (claimed.jobType === "cell_regeneration") {
      await processCellRegenerationJob(
        claimed.id,
        claimed.skillboardId,
        claimed.levelExpectationId,
      );
    } else {
      throw new Error(`unsupported job_type: ${claimed.jobType}`);
    }

    await db
      .update(skillboardAuthoringJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        lastError: null,
      })
      .where(eq(skillboardAuthoringJobs.id, claimed.id));

    return { processed: true, jobId: claimed.id, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    const willRetry = (claimed.attemptCount ?? 1) < MAX_JOB_ATTEMPTS;
    await db
      .update(skillboardAuthoringJobs)
      .set({
        status: willRetry ? "pending" : "failed",
        completedAt: willRetry ? null : new Date(),
        lastError: message,
      })
      .where(eq(skillboardAuthoringJobs.id, claimed.id));

    if (!willRetry) {
      await notify({
        severity: "error",
        eventType: "skillboard_cell_regen_failed",
        payload: {
          job_id: claimed.id,
          skillboard_id: claimed.skillboardId,
          attempts: claimed.attemptCount,
          error: message,
        },
      });
    }

    return {
      processed: true,
      jobId: claimed.id,
      success: false,
      error: message,
    };
  }
}

async function processTaskCellsJob(
  jobId: string,
  skillboardId: string,
  taskId: string | null,
): Promise<void> {
  if (!taskId) {
    throw new Error("task_cells job missing task_id");
  }

  // Pull task + skill + board context for the prompt.
  const ctx = await db
    .select({
      taskName: tasks.name,
      skillName: skills.name,
      specialisation: skillboards.specialisation,
      brief: skillboards.claudeAuthoringBrief,
      roleFamily: skillboards.roleFamily,
      skillId: skills.id,
    })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .innerJoin(skillboards, eq(skillboards.id, skills.skillboardId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  const row = ctx[0];
  if (!row) {
    throw new Error(`task not found: ${taskId}`);
  }

  const siblings = await db
    .select({ name: tasks.name })
    .from(tasks)
    .where(eq(tasks.skillId, row.skillId));

  const args: TaskCellsPromptArgs = {
    specialisation: row.specialisation,
    brief: row.brief ?? "",
    skillName: row.skillName,
    taskName: row.taskName,
    roleFamily: row.roleFamily,
    siblingTaskNames: siblings
      .map((s) => s.name)
      .filter((n) => n !== row.taskName),
  };
  const { system, user } = buildTaskCellsPrompt(args);

  const result = await withOpusBudget("skillboard_authoring", () =>
    callOpusRaw({
      system,
      messages: [{ role: "user", content: user }],
      // Cell generation rarely needs web search — disable to save cost.
      maxTokens: 4000,
    }),
  );

  const parsed = parseJsonResponse(result.text, taskCellsOutputSchema);

  // Persist each cell.
  for (const c of parsed.cells) {
    await setExpectationText({
      taskId,
      band: c.band as SeniorityBand,
      level: c.level as PerformanceLevel,
      expectationText: c.expectation_text,
      synthesised: true,
    });
  }

  await db
    .update(skillboardAuthoringJobs)
    .set({
      result: parsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsdX10000: result.costUsdX10000,
    })
    .where(eq(skillboardAuthoringJobs.id, jobId));

  void skillboardId; // satisfy lint; kept for symmetry with regen branch
}

async function processCellRegenerationJob(
  jobId: string,
  _skillboardId: string,
  levelExpectationId: string | null,
): Promise<void> {
  if (!levelExpectationId) {
    throw new Error("cell_regeneration job missing level_expectation_id");
  }

  const ctx = await db
    .select({
      cellId: levelExpectations.id,
      band: levelExpectations.band,
      level: levelExpectations.level,
      previousText: levelExpectations.expectationText,
      rejectionNotes: levelExpectations.rejectionNotes,
      taskId: tasks.id,
      taskName: tasks.name,
      skillName: skills.name,
      specialisation: skillboards.specialisation,
    })
    .from(levelExpectations)
    .innerJoin(tasks, eq(tasks.id, levelExpectations.taskId))
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .innerJoin(skillboards, eq(skillboards.id, skills.skillboardId))
    .where(eq(levelExpectations.id, levelExpectationId))
    .limit(1);
  const row = ctx[0];
  if (!row) {
    throw new Error(`level_expectation not found: ${levelExpectationId}`);
  }
  if (!row.rejectionNotes || row.rejectionNotes.trim().length === 0) {
    throw new Error(
      `cell ${levelExpectationId} has no rejection_notes — nothing to regenerate from`,
    );
  }

  const args: CellRegenPromptArgs = {
    specialisation: row.specialisation,
    skillName: row.skillName,
    taskName: row.taskName,
    band: row.band as SeniorityBand,
    level: row.level as PerformanceLevel,
    previousText: row.previousText,
    rejectionNotes: row.rejectionNotes,
  };
  const { system, user } = buildCellRegenPrompt(args);

  const result = await withOpusBudget("skillboard_cell_regen", () =>
    callOpusRaw({
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 1500,
    }),
  );

  const parsed = parseJsonResponse(result.text, cellRegenOutputSchema);

  await setExpectationText({
    taskId: row.taskId,
    band: row.band as SeniorityBand,
    level: row.level as PerformanceLevel,
    expectationText: parsed.expectation_text,
    synthesised: true,
  });

  await db
    .update(skillboardAuthoringJobs)
    .set({
      result: parsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsdX10000: result.costUsdX10000,
    })
    .where(eq(skillboardAuthoringJobs.id, jobId));
}

/* ---------- Cell regeneration (enqueue side) ---------- */

/**
 * Enqueue a cell regeneration job for a previously-rejected cell.
 * Caller (the reject route) must have just persisted the rejection notes
 * on the cell — this function reads them via the worker.
 *
 * Caps regeneration at 3 attempts (enforced upstream by the route via
 * `isRegenerationCapped`).
 */
export async function enqueueCellRegeneration(args: {
  skillboardId: string;
  levelExpectationId: string;
}): Promise<{ jobId: string }> {
  const [job] = await db
    .insert(skillboardAuthoringJobs)
    .values({
      skillboardId: args.skillboardId,
      jobType: "cell_regeneration",
      levelExpectationId: args.levelExpectationId,
    })
    .returning({ id: skillboardAuthoringJobs.id });
  return { jobId: job.id };
}

/* ---------- Status read for the UI ---------- */

export type AuthoringStatus = {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  failed: number;
  /**
   * Regeneration jobs that were created via bulk-reject with
   * regen_mode='stage'. They sit pending but with paused_until_review=true
   * so the worker skips them. Admin reviews + clicks Start (or Cancel) on
   * the staged-regens banner to release them.
   */
  staged: number;
  last_error: string | null;
};

export async function getAuthoringStatus(
  skillboardId: string,
): Promise<AuthoringStatus> {
  const rows = await db
    .select({
      status: skillboardAuthoringJobs.status,
      pausedUntilReview: skillboardAuthoringJobs.pausedUntilReview,
      lastError: skillboardAuthoringJobs.lastError,
      completedAt: skillboardAuthoringJobs.completedAt,
    })
    .from(skillboardAuthoringJobs)
    .where(eq(skillboardAuthoringJobs.skillboardId, skillboardId));

  const counts = {
    total: rows.length,
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
    staged: 0,
    last_error: null as string | null,
  };
  let lastErrorAt: Date | null = null;
  for (const r of rows) {
    // Staged jobs are still in 'pending' status but paused — we want
    // the banner to count them separately, NOT as pending (else the
    // worker-progress UI shows "X pending" for jobs that won't run).
    if (r.status === "pending" && r.pausedUntilReview) {
      counts.staged += 1;
    } else {
      counts[r.status] += 1;
    }
    if (r.lastError && r.completedAt && (!lastErrorAt || r.completedAt > lastErrorAt)) {
      counts.last_error = r.lastError;
      lastErrorAt = r.completedAt;
    }
  }
  return counts;
}

/* ---------- Internal helpers ---------- */

async function rescueStuckJobs(skillboardId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
  await db
    .update(skillboardAuthoringJobs)
    .set({
      status: "pending",
      claimedAt: null,
    })
    .where(
      and(
        eq(skillboardAuthoringJobs.skillboardId, skillboardId),
        eq(skillboardAuthoringJobs.status, "in_progress"),
        lt(skillboardAuthoringJobs.claimedAt, cutoff),
      ),
    );
}

/**
 * Strip optional ```json fences and parse with Zod. Throws with the raw
 * text on failure so the worker can record `last_error` and retry.
 */
function parseJsonResponse<T>(raw: string, schema: z.ZodSchema<T>): T {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(
      `Opus response was not valid JSON: ${err instanceof Error ? err.message : ""}. Raw: ${trimmed.slice(0, 200)}…`,
    );
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Opus response failed schema: ${JSON.stringify(result.error.flatten())}. Raw: ${trimmed.slice(0, 200)}…`,
    );
  }
  return result.data;
}

// `Skillboard` type satisfies lint — keeps tree-shaking happy if this
// file ends up being the entry point for an isolated authoring tool.
export type { Skillboard };
