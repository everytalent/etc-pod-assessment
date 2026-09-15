/**
 * Re-queue authoring jobs that failed for reasons that no longer apply.
 *
 * 439 jobs were sitting in `failed` and nothing ever retried them, which
 * is why four activated skillboards were live with almost no questions:
 * System Design and Project Engineering on 3 each, Solar Installation on
 * 6. Candidates in those specialisations were being turned away from a
 * board that existed and was switched on.
 *
 * Two causes, both since fixed:
 *
 *   - The Opus monthly cap was exhausted in June ($130.18 of $130).
 *     It resets monthly and has been nearly untouched since.
 *   - The claim UPDATE had no LIMIT, so it incremented attempt_count on
 *     every pending row for a board each time any one of them was
 *     claimed. Jobs burned through MAX_JOB_ATTEMPTS while queueing and
 *     were marked failed without ever having run, which is why boards
 *     show attempt counts in the dozens against a limit of a handful.
 *     attempt_count is therefore reset to 0 here: those counts record
 *     the bug, not real attempts.
 *
 * Scope: only boards that are activated and not archived. The archived
 * per-tenant Recruitment Consultant boards account for 85 of the
 * failures and regenerating them would spend real money on rows nobody
 * reads.
 *
 * Run: pnpm dotenv -e .env.local -- pnpm tsx scripts/requeue-failed-authoring-jobs.ts [--dry-run]
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "../lib/db/client";
import { skillboardAuthoringJobs, skillboards } from "../lib/db/schema";

/** Rough per-job Opus cost, for the spend estimate only. */
const EST_COST_PER_JOB_USD = 0.05;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const candidates = await db
    .select({
      id: skillboardAuthoringJobs.id,
      specialisation: skillboards.specialisation,
    })
    .from(skillboardAuthoringJobs)
    .innerJoin(
      skillboards,
      eq(skillboards.id, skillboardAuthoringJobs.skillboardId),
    )
    .where(
      and(
        eq(skillboardAuthoringJobs.status, "failed"),
        isNotNull(skillboards.activatedAt),
        isNull(skillboards.archivedAt),
      ),
    );

  const byBoard = new Map<string, number>();
  for (const c of candidates) {
    byBoard.set(c.specialisation, (byBoard.get(c.specialisation) ?? 0) + 1);
  }

  console.log(`Failed jobs on live boards: ${candidates.length}`);
  for (const [spec, n] of [...byBoard.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} | ${spec}`);
  }
  console.log(
    `Estimated spend if re-run: ~$${(candidates.length * EST_COST_PER_JOB_USD).toFixed(2)}`,
  );

  if (dryRun) {
    console.log("\n--dry-run: nothing changed.");
    process.exit(0);
  }
  if (candidates.length === 0) {
    console.log("\nNothing to re-queue.");
    process.exit(0);
  }

  const ids = candidates.map((c) => c.id);
  // Chunked to stay well under Postgres parameter limits.
  let updated = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = await db
      .update(skillboardAuthoringJobs)
      .set({
        status: "pending",
        attemptCount: 0,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        lastError: null,
      })
      .where(
        sql`${skillboardAuthoringJobs.id} in (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
      .returning({ id: skillboardAuthoringJobs.id });
    updated += rows.length;
  }

  console.log(`\nRe-queued ${updated} job(s). The worker drains them on its next tick.`);
  process.exit(0);
}

void main();
