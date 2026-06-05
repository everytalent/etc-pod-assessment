/**
 * Long-lived skillboard authoring worker — runs on Railway.
 *
 * Permanent solution for the synchronous Opus calls that Netlify's
 * function timeout was killing. This is a single Node process that:
 *
 *   1. Resets any stuck `in_progress` rows older than 5 min
 *   2. Pulls the oldest pending non-paused job
 *   3. Processes it via processNextAuthoringJob (~30-60s for Opus)
 *   4. Sleeps 3 seconds when the queue is empty, then loops
 *   5. Logs a heartbeat every 60 seconds
 *
 * Differences from scripts/drain-jobs.ts:
 *   - never exits (loops forever)
 *   - sleeps between empty polls instead of breaking
 *   - emits heartbeat so Railway can confirm the process is alive
 *   - graceful shutdown on SIGTERM (Railway restart, deploy, etc.)
 *
 * Deploy: see docs/2026-06-04-skillboard-worker-railway-setup.md
 *
 * Required env (Railway):
 *   DATABASE_URL                    Supabase connection string
 *   ANTHROPIC_API_KEY               Opus calls
 *   ASSESSMENT_GEMINI_KEY           Gemini Flash (brief vet, translation)
 *   KIMI_API_KEY                    Kimi synthesis
 *   ETC_ASSESSMENT_SERVICE_TOKEN    outbound Onboarding callback
 *   ONBOARDING_API_URL              Onboarding base URL
 *   NEXT_PUBLIC_SUPABASE_URL        Supabase storage signed URLs
 *   SUPABASE_SERVICE_ROLE_KEY       same
 */

// Env loading: handled by the runtime.
//   - Railway: env vars come from the dashboard directly.
//   - Local: run `pnpm worker:local` (uses dotenv-cli to inject .env.local).
// We deliberately don't import dotenv here so the worker doesn't depend
// on a devDependency at runtime.
if (!process.env.DATABASE_URL) {
  console.error(
    "[worker] FATAL: DATABASE_URL not set. Crashing so Railway restarts and you notice.",
  );
  process.exit(1);
}

const { and, asc, desc, eq, lt, ne } = await import("drizzle-orm");
const { db } = await import("../lib/db/client.js");
const { skillboardAuthoringJobs } = await import("../lib/db/schema.js");
const { processNextAuthoringJob } = await import(
  "../lib/engines/assessment/skillboards/claude-author.js"
);

/* ---------- Config ---------- */

const EMPTY_QUEUE_SLEEP_MS = 3_000;
const STUCK_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const RESCUE_INTERVAL_MS = 60 * 1000;

/* ---------- Graceful shutdown ---------- */

let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (shuttingDown) {
      console.log(`[worker] ${sig} again — force exit`);
      process.exit(0);
    }
    console.log(`[worker] ${sig} received — draining current job then exit`);
    shuttingDown = true;
  });
}

/* ---------- Main loop ---------- */

let lastHeartbeat = 0;
let lastRescue = 0;
let totalProcessed = 0;
let totalFailed = 0;

console.log(
  `[worker] starting · db=${new URL(process.env.DATABASE_URL).hostname}`,
);

while (!shuttingDown) {
  try {
    // Periodic global rescue.
    if (Date.now() - lastRescue > RESCUE_INTERVAL_MS) {
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
          `[worker] rescued ${rescued.length} stuck in_progress job(s)`,
        );
      }
      lastRescue = Date.now();
    }

    // Periodic heartbeat.
    if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
      console.log(
        `[worker] heartbeat · processed=${totalProcessed} failed=${totalFailed}`,
      );
      lastHeartbeat = Date.now();
    }

    // Find the oldest pending job across all boards.
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
      await sleep(EMPTY_QUEUE_SLEEP_MS);
      continue;
    }

    const t0 = Date.now();
    try {
      const outcome = await processNextAuthoringJob(next.skillboardId);
      const ms = Date.now() - t0;
      if (outcome.processed) {
        if (outcome.success) {
          totalProcessed += 1;
          console.log(`[worker] ok board=${next.skillboardId.slice(0, 8)} ${ms}ms`);
        } else {
          totalFailed += 1;
          console.log(
            `[worker] failed board=${next.skillboardId.slice(0, 8)} ${ms}ms err=${(outcome.error ?? "").slice(0, 120)}`,
          );
        }
      } else {
        // Race: another worker / cron got this row first. Move on.
        console.log(
          `[worker] skip board=${next.skillboardId.slice(0, 8)} reason=${outcome.reason}`,
        );
      }
    } catch (err) {
      totalFailed += 1;
      const ms = Date.now() - t0;
      console.error(
        `[worker] threw board=${next.skillboardId.slice(0, 8)} ${ms}ms err=${err instanceof Error ? err.message.slice(0, 120) : "unknown"}`,
      );
      // Don't crash — keep the worker alive even when one job blows up.
      // The job's own attempt_count handles retry policy.
    }
  } catch (loopErr) {
    // Top-level catch: db connection blip, etc. Log + back off, then
    // keep looping. If DB is truly down, Railway will see the heartbeat
    // gap and restart us.
    console.error(
      `[worker] loop error: ${loopErr instanceof Error ? loopErr.message : "unknown"} — backing off 5s`,
    );
    await sleep(5_000);
  }
}

console.log(
  `[worker] shutdown · processed=${totalProcessed} failed=${totalFailed}`,
);
process.exit(0);

/* ---------- Helpers ---------- */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Keep these imports referenced for tree-shake friendliness.
void desc;
void ne;
