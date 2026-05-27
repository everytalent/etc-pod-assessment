/**
 * Skillboard activator — the gate that decides whether a skillboard
 * is ready to back live candidate validation.
 *
 * Activation rule (PRD §1b): **every** level_expectations cell must be
 * `approved`. Any pending or rejected cell blocks activation. Once
 * activated, `activated_at` is stamped and the CAT engine can pick
 * questions anchored to this board.
 *
 * Pure data: no AI, no notify, no IO beyond DB queries. The route
 * handler glues this to the request and applies role permission.
 */

import { and, count, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  levelExpectations,
  skillboards,
  skills,
  tasks,
} from "@/lib/db/schema";

export type ActivationCheck = {
  ready: boolean;
  total_cells: number;
  pending: number;
  rejected: number;
  reason: string | null;
};

/**
 * Check (don't mutate) — used by both the API and the admin UI banner.
 * Returns counts so the UI can render "12 of 375 cells still pending."
 */
export async function checkActivationReadiness(
  skillboardId: string,
): Promise<ActivationCheck> {
  // Count cells by approval state in one query. The join chain
  // skillboards → skills → tasks → level_expectations is required
  // because cells don't carry a direct skillboard FK.
  const [totalRow] = await db
    .select({
      total: count(levelExpectations.id),
    })
    .from(levelExpectations)
    .innerJoin(tasks, eq(tasks.id, levelExpectations.taskId))
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(skills.skillboardId, skillboardId));

  const [unapprovedRow] = await db
    .select({
      pending: count(),
    })
    .from(levelExpectations)
    .innerJoin(tasks, eq(tasks.id, levelExpectations.taskId))
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(
      and(
        eq(skills.skillboardId, skillboardId),
        eq(levelExpectations.approvalState, "pending"),
      ),
    );

  const [rejectedRow] = await db
    .select({
      rejected: count(),
    })
    .from(levelExpectations)
    .innerJoin(tasks, eq(tasks.id, levelExpectations.taskId))
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(
      and(
        eq(skills.skillboardId, skillboardId),
        eq(levelExpectations.approvalState, "rejected"),
      ),
    );

  const total = Number(totalRow?.total ?? 0);
  const pending = Number(unapprovedRow?.pending ?? 0);
  const rejected = Number(rejectedRow?.rejected ?? 0);

  let reason: string | null = null;
  if (total === 0) {
    reason =
      "Skillboard has no expectation cells. Run the Claude authoring step or import an Excel before activating.";
  } else if (pending > 0 && rejected > 0) {
    reason = `${pending} cell(s) still pending and ${rejected} cell(s) rejected. Approve or regenerate the rejected ones first.`;
  } else if (pending > 0) {
    reason = `${pending} of ${total} cells are still pending approval.`;
  } else if (rejected > 0) {
    reason = `${rejected} cell(s) are rejected. Edit-then-approve them, or regenerate via Claude.`;
  }

  return {
    ready: reason === null,
    total_cells: total,
    pending,
    rejected,
    reason,
  };
}

/**
 * Set `activated_at = now()` on the skillboard. Caller MUST have called
 * `checkActivationReadiness()` first and confirmed `ready === true`.
 * This function trusts the caller; the API route is the right place
 * to enforce the gate (so 422 errors are clean and consistent).
 */
export async function markActivated(skillboardId: string): Promise<void> {
  await db
    .update(skillboards)
    .set({ activatedAt: new Date(), updatedAt: new Date() })
    .where(eq(skillboards.id, skillboardId));
}

/**
 * Inverse: deactivate a board (e.g. after a Learning Expert spots a
 * problem post-activation). Doesn't delete cells — just unstamps
 * activated_at so the CAT engine can't pick from it.
 */
export async function markDeactivated(skillboardId: string): Promise<void> {
  await db
    .update(skillboards)
    .set({ activatedAt: null, updatedAt: new Date() })
    .where(eq(skillboards.id, skillboardId));
}

/**
 * Quick "is this board live?" check used by the CAT engine and the
 * question-bank Opus seed job. Returns true only if `activated_at`
 * is set AND no cells were rejected since (a safety belt against
 * stale state if someone hand-edits a row).
 */
export async function isSkillboardLive(
  skillboardId: string,
): Promise<boolean> {
  const [board] = await db
    .select({ activatedAt: skillboards.activatedAt })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!board?.activatedAt) return false;

  // Safety belt: any non-approved cell pulls the board offline.
  const [anyUnapproved] = await db
    .select({ id: levelExpectations.id })
    .from(levelExpectations)
    .innerJoin(tasks, eq(tasks.id, levelExpectations.taskId))
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(
      and(
        eq(skills.skillboardId, skillboardId),
        ne(levelExpectations.approvalState, "approved"),
      ),
    )
    .limit(1);

  return !anyUnapproved;
}
