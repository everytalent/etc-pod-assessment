/**
 * Cron worker — drives the skillboard authoring queue when no tab is
 * keeping the browser-side polling loop alive.
 *
 *   POST /api/cron/process-authoring-queue
 *
 * Auth: a shared secret in the `Authorization: Bearer <token>` header,
 * matched against the `WORKER_CRON_SECRET` env var. No user session.
 *
 * Behaviour:
 *   - Finds the oldest pending (non-paused) job across ALL skillboards
 *   - Processes it once
 *   - Returns a small JSON summary
 *
 * Schedule (configured in netlify.toml):
 *   every 5 minutes
 *
 * Why 5 minutes:
 *   - One job ≈ 8-15 s on Opus, so a single tick can't drain a whole
 *     board. The point isn't throughput — it's *eventual* progress
 *     when admins close their tabs and forget. Throughput cases keep
 *     a tab open and use the browser polling loop.
 *   - Netlify's minimum scheduled interval is @every 1 minute; 5 min
 *     keeps cost low and avoids racing the browser worker.
 *
 * Safety:
 *   - The same row-lock (`SELECT … FOR UPDATE SKIP LOCKED`) used by
 *     the browser endpoint is reused, so we can't double-claim a job.
 *   - Paused (staged) jobs are excluded by the worker's existing
 *     filter — no special-casing here.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import { skillboardAuthoringJobs } from "@/lib/db/schema";
import { processNextAuthoringJob } from "@/lib/engines/assessment/skillboards/claude-author";

/**
 * Number of jobs to process in one cron tick. One is the safe default
 * (limits damage if a job spirals). If you want to drain faster across
 * many boards in a single tick, bump this — but each adds 8-15 s of
 * Opus latency to the response, and Netlify's function timeout is 26 s.
 */
const JOBS_PER_TICK = 1;

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.WORKER_CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        error: "cron_secret_not_configured",
        message:
          "Set WORKER_CRON_SECRET in env. Without it, the cron endpoint is disabled.",
      },
      { status: 503 },
    );
  }
  const provided = (req.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Find the oldest pending (non-paused) job across all skillboards.
  // We claim ONE board per tick (the one with the oldest pending job)
  // and call processNextAuthoringJob, which handles its own row-locking.
  const results: Array<{
    skillboardId: string;
    outcome: string;
    durationMs: number;
  }> = [];

  for (let i = 0; i < JOBS_PER_TICK; i++) {
    const [oldest] = await db
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

    if (!oldest) {
      break; // queue is empty
    }

    const t0 = Date.now();
    const outcome = await processNextAuthoringJob(oldest.skillboardId);
    results.push({
      skillboardId: oldest.skillboardId,
      outcome: outcome.kind,
      durationMs: Date.now() - t0,
    });

    // Stop early if processNextAuthoringJob reports nothing to do — the
    // board's queue might have been drained between our SELECT and the
    // worker's claim (race with browser tab).
    if (outcome.kind === "no_pending_jobs") break;
  }

  void desc; // import-keep — kept for future ORDER BY tweaks
  return NextResponse.json({
    ticked_at: new Date().toISOString(),
    jobs_processed: results.length,
    results,
  });
}
