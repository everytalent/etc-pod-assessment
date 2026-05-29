/**
 * One-shot worker: drains all pending authoring jobs from the queue.
 *
 * Use case: Netlify's 30s function timeout is killing Opus mid-call on
 * structure / bank_seed jobs. Run this script from your local machine
 * (no timeout) to push them through.
 *
 *   pnpm tsx scripts/drain-jobs.ts
 *
 * Reads DATABASE_URL + ANTHROPIC_API_KEY from .env.local. Hits the
 * SAME Supabase that production hits, so processed jobs disappear from
 * the production queue and the production bank/structure gets seeded.
 *
 * Safety: only processes jobs in status='pending' AND paused_until_review=false.
 * Runs them one at a time so a failure on one doesn't poison the rest.
 */

import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load env BEFORE importing any module that reads process.env at parse time.
// Next.js convention: .env.local overrides .env. Both checked here.
const root = resolve(__dirname, "..");
for (const file of [".env", ".env.local"]) {
  const p = resolve(root, file);
  if (existsSync(p)) loadEnv({ path: p, override: true });
}
if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL not found in .env or .env.local — drain-jobs cannot connect.",
  );
  process.exit(1);
}
// Print which DB we're connecting to (host only — never the password).
try {
  const u = new URL(process.env.DATABASE_URL);
  console.log(`DB host: ${u.hostname}  db: ${u.pathname.slice(1)}`);
} catch {
  // ignore
}

async function main() {
  // Dynamic imports: lib/db/client.ts reads DATABASE_URL at module
  // load time. Must run AFTER loadEnv above, hence the await import.
  const { and, eq, lt } = await import("drizzle-orm");
  const { db } = await import("../lib/db/client.js");
  const { skillboardAuthoringJobs } = await import("../lib/db/schema.js");
  const { processNextAuthoringJob } = await import(
    "../lib/engines/assessment/skillboards/claude-author.js"
  );

  const startedAt = Date.now();
  let processed = 0;
  const outcomes: Array<{
    skillboard_id: string;
    outcome: string;
    ms: number;
  }> = [];

  // Diagnostic: dump every job row so we can see exactly what's in the
  // queue, including failed ones (status='failed' after maxAttempts
  // exhausted). Limited to 50 rows by created_at desc.
  // Status histogram across ALL rows.
  const { sql, desc, ne } = await import("drizzle-orm");
  const histogram = await db.execute(
    sql`SELECT status, job_type, COUNT(*)::int AS n
        FROM skillboard_authoring_jobs
        GROUP BY status, job_type
        ORDER BY status, job_type`,
  );
  // postgres.js returns an array directly (not { rows: [...] }).
  const histRows = (
    histogram as unknown as { status: string; job_type: string; n: number }[]
  );
  console.log("\nStatus histogram (all rows):");
  for (const r of histRows) {
    console.log(`  ${r.status.padEnd(12)} ${r.job_type.padEnd(18)} ${r.n}`);
  }

  // Detail for the 30 NEWEST non-completed rows (so we see today's
  // pending/in_progress/failed jobs, not last week's completed ones).
  const recent = await db
    .select({
      id: skillboardAuthoringJobs.id,
      skillboardId: skillboardAuthoringJobs.skillboardId,
      jobType: skillboardAuthoringJobs.jobType,
      status: skillboardAuthoringJobs.status,
      attemptCount: skillboardAuthoringJobs.attemptCount,
      pausedUntilReview: skillboardAuthoringJobs.pausedUntilReview,
      claimedAt: skillboardAuthoringJobs.claimedAt,
      lastError: skillboardAuthoringJobs.lastError,
      createdAt: skillboardAuthoringJobs.createdAt,
    })
    .from(skillboardAuthoringJobs)
    .where(ne(skillboardAuthoringJobs.status, "completed"))
    .orderBy(desc(skillboardAuthoringJobs.createdAt))
    .limit(30);

  console.log(`\n${recent.length} non-completed job rows (newest first):`);
  for (const r of recent) {
    console.log(
      `  ${r.status.padEnd(11)} ${r.jobType.padEnd(18)} attempts=${r.attemptCount} paused=${r.pausedUntilReview} board=${r.skillboardId.slice(0, 8)} created=${r.createdAt.toISOString().slice(0, 19)} err=${(r.lastError ?? "").slice(0, 80)}`,
    );
  }

  // AGGRESSIVE rescue: the Netlify cron has been holding jobs in
  // in_progress because Opus calls > 30s never complete on Netlify's
  // standard-plan function timeout. Anything currently in_progress
  // is therefore a stuck row that won't ever finish via the cron.
  // We reset everything in_progress to pending (regardless of age)
  // so the local drainer can claim and complete them.
  const rescued = await db
    .update(skillboardAuthoringJobs)
    .set({ status: "pending", claimedAt: null })
    .where(eq(skillboardAuthoringJobs.status, "in_progress"))
    .returning({ id: skillboardAuthoringJobs.id });
  if (rescued.length > 0) {
    console.log(`Reset ${rescued.length} in_progress job(s) to pending.`);
  }
  void lt; // import-keep

  for (let i = 0; i < 100; i++) {
    // Re-rescue every iteration — the Netlify cron races with us,
    // claiming pending rows the instant we release them. Resetting
    // in_progress → pending each loop lets us re-claim them locally.
    await db
      .update(skillboardAuthoringJobs)
      .set({ status: "pending", claimedAt: null })
      .where(eq(skillboardAuthoringJobs.status, "in_progress"));

    const [next] = await db
      .select({ skillboardId: skillboardAuthoringJobs.skillboardId })
      .from(skillboardAuthoringJobs)
      .where(
        and(
          eq(skillboardAuthoringJobs.status, "pending"),
          eq(skillboardAuthoringJobs.pausedUntilReview, false),
        ),
      )
      .limit(1);

    if (!next) {
      console.log("\n✓ queue empty");
      break;
    }

    const t0 = Date.now();
    console.log(
      `[${new Date().toISOString()}] processing job for board ${next.skillboardId}…`,
    );
    try {
      const outcome = await processNextAuthoringJob(next.skillboardId);
      const ms = Date.now() - t0;
      const label = outcome.processed
        ? outcome.success
          ? "ok"
          : `failed (${outcome.error?.slice(0, 100)})`
        : outcome.reason;
      console.log(`  → ${label} (${ms}ms)`);
      outcomes.push({
        skillboard_id: next.skillboardId,
        outcome: label,
        ms,
      });
      processed += 1;
    } catch (err) {
      const ms = Date.now() - t0;
      const label = err instanceof Error ? err.message : "unknown";
      console.error(`  ✗ ${label} (${ms}ms)`);
      outcomes.push({ skillboard_id: next.skillboardId, outcome: label, ms });
    }
  }

  console.log(`\nProcessed ${processed} jobs in ${Date.now() - startedAt}ms`);
  console.log(JSON.stringify(outcomes, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
