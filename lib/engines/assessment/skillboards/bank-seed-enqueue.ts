/**
 * Enqueue the bank_seed jobs that fill a skillboard's validation bank.
 *
 * One job per (band × level × task) cell. The authoring worker picks
 * them up and auto-approves the questions straight into the bank, so an
 * activated skillboard stops being an empty shell.
 *
 * Extracted from the admin activate route so the automatic
 * provisioning path (lib/engines/assessment/auto-provision.ts) queues
 * exactly the same work. A candidate whose specialisation we had never
 * seen must end up with the same bank an admin would have produced;
 * two copies of this loop would have drifted the moment either changed.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  skillboardAuthoringJobs,
  skillboards,
  skills,
  tasks,
  type AuthoringJobType,
  type PerformanceLevel,
  type SeniorityBand,
} from "@/lib/db/schema";

const BANDS: SeniorityBand[] = ["junior", "mid", "senior"];
const LEVELS: PerformanceLevel[] = ["below", "nh", "g", "p", "tp"];

/** Postgres parameter limits: chunk inserts for a 400+ cell board. */
const INSERT_CHUNK = 500;

export async function enqueueBankSeedJobs(
  skillboardId: string,
  opts: { questionsPerCell?: number } = {},
): Promise<number> {
  const questionsPerCell = opts.questionsPerCell ?? 3;

  const [board] = await db
    .select({ specialisation: skillboards.specialisation })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!board) return 0;

  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, skillboardId));
  if (taskRows.length === 0) return 0;

  const rows: {
    skillboardId: string;
    jobType: AuthoringJobType;
    taskId: string;
    result: unknown;
  }[] = [];

  for (const t of taskRows) {
    for (const b of BANDS) {
      for (const l of LEVELS) {
        rows.push({
          skillboardId,
          jobType: "bank_seed" as AuthoringJobType,
          taskId: t.id,
          // The worker reads its payload from the `result` column
          // (mis-named but established).
          result: {
            specialisation: board.specialisation,
            band: b,
            level: l,
            task_id: t.id,
            questions_per_cell: questionsPerCell,
            auto_approve: true,
          },
        });
      }
    }
  }

  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db
      .insert(skillboardAuthoringJobs)
      .values(rows.slice(i, i + INSERT_CHUNK));
  }

  return rows.length;
}
