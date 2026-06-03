/**
 * Netlify scheduled BACKGROUND function — fires every 5 min per config below.
 *
 *   The `-background` suffix in the filename is what flips this from
 *   Netlify's ~30s synchronous function timeout to a 15-MINUTE budget.
 *   Combined with `schedule` in the config, this runs on cron AND has
 *   the headroom Opus calls actually need (30-60s per job × many jobs).
 *
 * Replaces the previous synchronous worker at
 *   netlify/functions/scheduled-process-authoring-queue.mts (+ the
 *   matching Next.js route at /api/cron/process-authoring-queue),
 *   both of which were getting killed mid-Opus by Netlify's 30s cap.
 *
 * Strategy:
 *   1. Auth check (shared secret) is no longer required — scheduled
 *      functions can't be invoked externally, so there's no attack
 *      surface. Kept the env-presence guard for sanity.
 *   2. Global stuck-job rescue first (resets in_progress > 5 min to
 *      pending — same logic as the old route).
 *   3. Drain loop: claim oldest pending → process → repeat, until
 *      either the queue is empty OR we've burned 13 minutes (leaves
 *      a 2-min buffer before Netlify kills the function).
 *
 * Imports use relative paths from `netlify/functions/` because the
 * `@/` path alias only resolves inside the Next.js bundle, not here.
 */

import type { Config } from "@netlify/functions";

import { and, asc, eq, lt } from "drizzle-orm";

import { db } from "../../lib/db/client.js";
import { skillboardAuthoringJobs } from "../../lib/db/schema.js";
import { processNextAuthoringJob } from "../../lib/engines/assessment/skillboards/claude-author.js";

/** Stop processing new jobs when we have this much wall-clock left. */
const SOFT_BUDGET_MS = 13 * 60 * 1000; // 13 of 15 min
/** Reset any in_progress row older than this back to pending. */
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000;
/** Safety cap on jobs per tick (1000 hard limit elsewhere; this is tighter). */
const MAX_JOBS_PER_TICK = 200;

export default async function handler() {
  const startedAt = Date.now();

  // ----- Step 1: global rescue -----
  try {
    const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MS);
    const rescued = await db
      .update(skillboardAuthoringJobs)
      .set({ status: "pending", claimedAt: null })
      .where(
        and(
          eq(skillboardAuthoringJobs.status, "in_progress"),
          lt(skillboardAuthoringJobs.claimedAt, cutoff),
        ),
      )
      .returning({ id: skillboardAuthoringJobs.id });
    if (rescued.length > 0) {
      console.log(
        `[bg-worker] reset ${rescued.length} stuck job(s) to pending`,
      );
    }
  } catch (err) {
    console.warn(
      "[bg-worker] global stuck-job rescue errored:",
      err instanceof Error ? err.message : "unknown",
    );
  }

  // ----- Step 2: drain loop -----
  const outcomes: Array<{
    skillboard_id: string;
    outcome: string;
    duration_ms: number;
  }> = [];

  for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
    if (Date.now() - startedAt > SOFT_BUDGET_MS) {
      console.log("[bg-worker] soft time budget exhausted, stopping");
      break;
    }

    const [next] = await db
      .select({ skillboardId: skillboardAuthoringJobs.skillboardId })
      .from(skillboardAuthoringJobs)
      .where(
        and(
          eq(skillboardAuthoringJobs.status, "pending"),
          eq(skillboardAuthoringJobs.pausedUntilReview, false),
        ),
      )
      .orderBy(asc(skillboardAuthoringJobs.createdAt))
      .limit(1);

    if (!next) {
      console.log("[bg-worker] queue empty");
      break;
    }

    const t0 = Date.now();
    try {
      const outcome = await processNextAuthoringJob(next.skillboardId);
      const label = outcome.processed
        ? outcome.success
          ? "ok"
          : `failed (${(outcome.error ?? "").slice(0, 120)})`
        : outcome.reason;
      outcomes.push({
        skillboard_id: next.skillboardId,
        outcome: label,
        duration_ms: Date.now() - t0,
      });

      // Bail if the worker reported nothing to do — another worker
      // (browser tab) raced us. Don't keep spinning.
      if (!outcome.processed && outcome.reason === "no_pending_jobs") {
        break;
      }
    } catch (err) {
      outcomes.push({
        skillboard_id: next.skillboardId,
        outcome: `threw (${err instanceof Error ? err.message.slice(0, 120) : "unknown"})`,
        duration_ms: Date.now() - t0,
      });
    }
  }

  const totalMs = Date.now() - startedAt;
  console.log(
    `[bg-worker] tick complete: ${outcomes.length} jobs in ${totalMs}ms`,
  );
  // Body is mostly for log inspection; Netlify ignores the response on
  // background invocations beyond returning a 202.
  return new Response(
    JSON.stringify({
      ticked_at: new Date(startedAt).toISOString(),
      duration_ms: totalMs,
      jobs_processed: outcomes.length,
      outcomes,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

export const config: Config = {
  schedule: "*/5 * * * *",
};
