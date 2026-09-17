/**
 * Give in-flight validation sessions the CAT snapshot they never kept.
 *
 * The answers route was overwriting metadata.adaptive_plan on every
 * answer, so no in-progress session has one. With the overwrite fixed,
 * those sessions would start counting from zero and hand the candidate a
 * further full-length assessment on top of what they have already sat.
 * One of them has answered 18 questions and would have been asked
 * another 17.
 *
 * This seeds each one with the count it has actually reached, so the
 * budget applies to their whole sitting rather than to the part that
 * happens to come after the fix. Anyone already at or past their budget
 * finishes on their next answer.
 *
 * The estimate is deliberately left at its starting value: we cannot
 * reconstruct it from answers that were never scored, and inventing one
 * would put a number on a candidate's ability that no evidence
 * supports. Their result comes from synthesis over the answers
 * themselves, which is unaffected.
 *
 * Idempotent: sessions that already have a plan are skipped.
 *
 * Run: pnpm dotenv -e .env.local -- pnpm tsx scripts/backfill-cat-snapshots.ts [--dry-run]
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../lib/db/client";
import { answers, assessments, responses } from "../lib/db/schema";
import { initialSnapshot } from "../lib/engines/assessment/cat/state-machine";
import { PER_SPEC_BUDGET } from "../lib/engines/assessment/cat/picker";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const rows = await db
    .select({
      id: responses.id,
      candidateName: responses.candidateName,
      metadata: responses.metadata,
      specialisation: assessments.specialisation,
      answered: sql<number>`(
        SELECT count(*)::int FROM ${answers} a WHERE a.response_id = ${responses.id}
      )`,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(
      and(eq(responses.status, "in_progress"), eq(assessments.mode, "validation")),
    );

  let seeded = 0;
  let skipped = 0;

  for (const row of rows) {
    const meta = (row.metadata ?? {}) as Record<string, unknown> & {
      walk_order?: string[];
      claimed_band?: "junior" | "mid" | "senior";
      adaptive_plan?: unknown[];
    };

    if (Array.isArray(meta.adaptive_plan) && meta.adaptive_plan.length > 0) {
      skipped += 1;
      continue;
    }
    // Nothing answered means nothing to preserve; the session will build
    // its own snapshot correctly from the first answer.
    if (row.answered === 0 || !row.specialisation) {
      skipped += 1;
      continue;
    }

    const specCount = Math.max(1, Math.min(4, meta.walk_order?.length ?? 1));
    const budgetRow = PER_SPEC_BUDGET[specCount] ?? PER_SPEC_BUDGET[1]!;
    const isPrimary = (meta.walk_order?.[0] ?? row.id) === row.id;
    const budget = isPrimary ? budgetRow.primary : budgetRow.secondary;

    const snapshot = {
      ...initialSnapshot({
        claimedBand: meta.claimed_band ?? "junior",
        budget,
      }),
      answeredCount: row.answered,
      windowCount: row.answered,
      specialisation: row.specialisation,
    };

    const remaining = Math.max(0, budget - row.answered);
    console.log(
      `${dryRun ? "[dry] " : "[seed] "}${(row.candidateName ?? "").slice(0, 24).padEnd(24)} ` +
        `answered=${String(row.answered).padStart(3)} budget=${String(budget).padStart(2)} ` +
        `-> ${remaining === 0 ? "ends on next answer" : `${remaining} question(s) left`}`,
    );

    if (!dryRun) {
      await db
        .update(responses)
        .set({ metadata: { ...meta, adaptive_plan: [snapshot] } })
        .where(eq(responses.id, row.id));
    }
    seeded += 1;
  }

  console.log(
    `\n${dryRun ? "would seed" : "seeded"} ${seeded}, skipped ${skipped} (no answers, or already had a plan).`,
  );
  process.exit(0);
}

void main();
