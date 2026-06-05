/**
 * Skillboard repository — all DB reads/writes for skillboards, skills,
 * tasks, and level_expectations.
 *
 * Pure-ish: no HTTP, no AI calls, no notify(). Routes and services call
 * these functions; this file never imports them. Keeps the audit
 * surface obvious (every DB write to the skillboard spine flows through
 * one file) and makes it easy to unit test against a test database.
 */

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  levelExpectations,
  skillboards,
  skills,
  tasks,
  type ApprovalState,
  type LevelExpectation,
  type NewSkillboard,
  type PerformanceLevel,
  type SeniorityBand,
  type Skillboard,
  type SkillboardBehaviouralSkill,
  type SkillboardCreationPath,
  type SkillboardMindset,
  type SkillboardRoleFamily,
  type SkillboardSourceFile,
} from "@/lib/db/schema";

import { BAND_ORDER, LEVEL_ORDER } from "../types";
import {
  MAX_REGENERATIONS_PER_CELL,
  type LevelExpectationCell,
  type SkillboardDetail,
  type SkillboardListRow,
  type SkillWithTasks,
  type TaskWithCells,
} from "./types";

/* ---------- Create ---------- */

export type CreateSkillboardArgs = {
  specialisation: string;
  description: string;
  creationPath: SkillboardCreationPath;
  roleFamily: SkillboardRoleFamily;
  parentSkillboardId?: string | null;
  mindsets?: SkillboardMindset[];
  behaviouralSkills?: SkillboardBehaviouralSkill[];
  sourceFiles?: SkillboardSourceFile[];
  claudeAuthoringBrief?: string | null;
  claudeAuthoringRunId?: string | null;
};

export async function createSkillboard(
  args: CreateSkillboardArgs,
): Promise<Skillboard> {
  const row: NewSkillboard = {
    specialisation: args.specialisation,
    description: args.description,
    creationPath: args.creationPath,
    roleFamily: args.roleFamily,
    parentSkillboardId: args.parentSkillboardId ?? null,
    mindsets: args.mindsets ?? [],
    behaviouralSkills: args.behaviouralSkills ?? [],
    sourceFiles: args.sourceFiles ?? null,
    claudeAuthoringBrief: args.claudeAuthoringBrief ?? null,
    claudeAuthoringRunId: args.claudeAuthoringRunId ?? null,
  };
  const [inserted] = await db.insert(skillboards).values(row).returning();
  return inserted;
}

/* ---------- Skills / tasks population ---------- */

/**
 * Bulk-insert the skill+task shape produced by either the Excel parser
 * (upload path) or Claude (claude_authored path). Either path produces
 * the same intermediate shape; this is the single insertion site.
 *
 * For every (task × band × level) combination the function also inserts
 * a `level_expectations` row — pending and empty by default; the
 * caller fills text in a subsequent step where it has the source
 * (parser cells, Claude output).
 */
export type SkillSeed = {
  name: string;
  orderIndex: number;
  tasks: TaskSeed[];
};

export type TaskSeed = {
  name: string;
  orderIndex: number;
};

export async function seedSkillsTasksAndEmptyCells(
  skillboardId: string,
  skillSeeds: SkillSeed[],
): Promise<{ skillIds: string[]; taskIds: string[] }> {
  const skillIds: string[] = [];
  const taskIds: string[] = [];

  for (const skillSeed of skillSeeds) {
    const [insertedSkill] = await db
      .insert(skills)
      .values({
        skillboardId,
        name: skillSeed.name,
        orderIndex: skillSeed.orderIndex,
      })
      .returning({ id: skills.id });
    skillIds.push(insertedSkill.id);

    for (const taskSeed of skillSeed.tasks) {
      const [insertedTask] = await db
        .insert(tasks)
        .values({
          skillId: insertedSkill.id,
          name: taskSeed.name,
          orderIndex: taskSeed.orderIndex,
        })
        .returning({ id: tasks.id });
      taskIds.push(insertedTask.id);

      // Seed the 15-cell grid as empty + pending. Cell text arrives
      // later via setExpectationText().
      const cellValues = [];
      for (const band of BAND_ORDER) {
        for (const level of LEVEL_ORDER) {
          cellValues.push({
            taskId: insertedTask.id,
            band,
            level,
            expectationText: "",
            synthesised: false,
            approvalState: "pending" as ApprovalState,
          });
        }
      }
      if (cellValues.length > 0) {
        await db.insert(levelExpectations).values(cellValues);
      }
    }
  }

  return { skillIds, taskIds };
}

/**
 * Populate (or update) one cell's expectation text + synthesised flag.
 * Resets `approval_state` to `pending` because new text needs a fresh
 * review pass, regardless of who authored it.
 */
export async function setExpectationText(args: {
  taskId: string;
  band: SeniorityBand;
  level: PerformanceLevel;
  expectationText: string;
  synthesised: boolean;
}): Promise<void> {
  await db
    .update(levelExpectations)
    .set({
      expectationText: args.expectationText,
      synthesised: args.synthesised,
      approvalState: "pending",
      // Clear any prior rejection notes — they belonged to old text.
      rejectionNotes: null,
      approvedBy: null,
      approvedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(levelExpectations.taskId, args.taskId),
        eq(levelExpectations.band, args.band),
        eq(levelExpectations.level, args.level),
      ),
    );
}

/* ---------- Read ---------- */

export async function getSkillboardById(
  id: string,
): Promise<Skillboard | null> {
  const [row] = await db
    .select()
    .from(skillboards)
    .where(eq(skillboards.id, id))
    .limit(1);
  return row ?? null;
}

export async function getSkillboardBySpecialisation(
  specialisation: string,
): Promise<Skillboard | null> {
  const [row] = await db
    .select()
    .from(skillboards)
    .where(eq(skillboards.specialisation, specialisation))
    .limit(1);
  return row ?? null;
}

/**
 * Lightweight list for /admin/skillboards. Hides archived boards by
 * default. Pass { includeArchived: true } to surface them (admin can
 * still see + restore via direct URL — this filter is for the list).
 */
export async function listSkillboards(
  opts: { includeArchived?: boolean } = {},
): Promise<SkillboardListRow[]> {
  // Run a sub-aggregate so we don't fetch every cell row to the app.
  const cellCounts = await db
    .select({
      skillboardId: skillboards.id,
      total: count(levelExpectations.id),
      pending: sql<number>`COUNT(*) FILTER (WHERE ${levelExpectations.approvalState} = 'pending')`,
    })
    .from(skillboards)
    .leftJoin(skills, eq(skills.skillboardId, skillboards.id))
    .leftJoin(tasks, eq(tasks.skillId, skills.id))
    .leftJoin(levelExpectations, eq(levelExpectations.taskId, tasks.id))
    .groupBy(skillboards.id);

  const byId = new Map(cellCounts.map((c) => [c.skillboardId, c]));

  const boards = await db
    .select({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
      creationPath: skillboards.creationPath,
      roleFamily: skillboards.roleFamily,
      activatedAt: skillboards.activatedAt,
      archivedAt: skillboards.archivedAt,
      updatedAt: skillboards.updatedAt,
    })
    .from(skillboards)
    .where(
      opts.includeArchived
        ? undefined
        : sql`${skillboards.archivedAt} IS NULL`,
    )
    .orderBy(asc(skillboards.specialisation));

  return boards.map((b) => ({
    id: b.id,
    specialisation: b.specialisation,
    creation_path: b.creationPath,
    role_family: b.roleFamily,
    activated_at: b.activatedAt?.toISOString() ?? null,
    archived_at: b.archivedAt?.toISOString() ?? null,
    cells_pending: Number(byId.get(b.id)?.pending ?? 0),
    cells_total: Number(byId.get(b.id)?.total ?? 0),
    updated_at: b.updatedAt.toISOString(),
  }));
}

/**
 * Hydrate a full skillboard tree: board → skills → tasks → cells. The
 * detail page renders directly from this. Heavy-ish (one query per
 * level), but skillboards have bounded size (~25 tasks × 15 cells =
 * 375 cells) so a sub-second response is fine.
 */
export async function getSkillboardDetail(
  id: string,
): Promise<SkillboardDetail | null> {
  const board = await getSkillboardById(id);
  if (!board) return null;

  const skillRows = await db
    .select()
    .from(skills)
    .where(eq(skills.skillboardId, id))
    .orderBy(asc(skills.orderIndex));

  const skillIds = skillRows.map((s) => s.id);
  const taskRows =
    skillIds.length === 0
      ? []
      : await db
          .select()
          .from(tasks)
          .where(inArray(tasks.skillId, skillIds))
          .orderBy(asc(tasks.skillId), asc(tasks.orderIndex));

  const taskIds = taskRows.map((t) => t.id);
  const cellRows =
    taskIds.length === 0
      ? []
      : await db
          .select()
          .from(levelExpectations)
          .where(inArray(levelExpectations.taskId, taskIds));

  const cellsByTask = groupBy(cellRows, (c) => c.taskId);
  const tasksBySkill = groupBy(taskRows, (t) => t.skillId);

  let totalCells = 0;
  let pendingCells = 0;
  let approvedCells = 0;
  let rejectedCells = 0;
  for (const c of cellRows) {
    totalCells += 1;
    if (c.approvalState === "pending") pendingCells += 1;
    else if (c.approvalState === "approved") approvedCells += 1;
    else if (c.approvalState === "rejected") rejectedCells += 1;
  }

  const skillsTree: SkillWithTasks[] = skillRows.map((skill) => {
    const taskList = tasksBySkill.get(skill.id) ?? [];
    return {
      id: skill.id,
      name: skill.name,
      order_index: skill.orderIndex,
      tasks: taskList.map<TaskWithCells>((t) => ({
        id: t.id,
        name: t.name,
        order_index: t.orderIndex,
        cells: (cellsByTask.get(t.id) ?? []).map(cellRowToOutput),
      })),
    };
  });

  return {
    id: board.id,
    specialisation: board.specialisation,
    description: board.description,
    version: board.version,
    mindsets: board.mindsets,
    behavioural_skills: board.behaviouralSkills,
    parent_skillboard_id: board.parentSkillboardId,
    creation_path: board.creationPath,
    role_family: board.roleFamily,
    claude_authoring_brief: board.claudeAuthoringBrief,
    activated_at: board.activatedAt?.toISOString() ?? null,
    archived_at: board.archivedAt?.toISOString() ?? null,
    cell_counts: {
      total: totalCells,
      pending: pendingCells,
      approved: approvedCells,
      rejected: rejectedCells,
    },
    skills: skillsTree,
  };
}

/* ---------- Edit board ---------- */

/**
 * Hard-delete a skillboard and everything it owns. ON DELETE CASCADE
 * on the FKs handles: skills → tasks → level_expectations, plus
 * skillboard_authoring_jobs.
 *
 * Does NOT touch: question_bank_proposals (their FK to tasks is
 * onDelete: 'set null', so they stay as orphaned proposal rows that
 * mention the now-deleted spec/task — by design, so a deleted board
 * doesn't silently drop pending bank submissions).
 *
 * Returns true if a row was actually deleted (false = no-op / not found).
 */
export async function deleteSkillboard(id: string): Promise<boolean> {
  const deleted = await db
    .delete(skillboards)
    .where(eq(skillboards.id, id))
    .returning({ id: skillboards.id });
  return deleted.length > 0;
}

export async function patchSkillboard(
  id: string,
  updates: {
    specialisation?: string;
    description?: string;
    mindsets?: SkillboardMindset[];
    behaviouralSkills?: SkillboardBehaviouralSkill[];
    parentSkillboardId?: string | null;
  },
): Promise<void> {
  await db
    .update(skillboards)
    .set({
      ...(updates.specialisation !== undefined && {
        specialisation: updates.specialisation,
      }),
      ...(updates.description !== undefined && {
        description: updates.description,
      }),
      ...(updates.mindsets !== undefined && { mindsets: updates.mindsets }),
      ...(updates.behaviouralSkills !== undefined && {
        behaviouralSkills: updates.behaviouralSkills,
      }),
      ...(updates.parentSkillboardId !== undefined && {
        parentSkillboardId: updates.parentSkillboardId,
      }),
      updatedAt: new Date(),
    })
    .where(eq(skillboards.id, id));
}

/* ---------- Approve / reject / edit cells ---------- */

export async function getLevelExpectation(
  id: string,
): Promise<LevelExpectation | null> {
  const [row] = await db
    .select()
    .from(levelExpectations)
    .where(eq(levelExpectations.id, id))
    .limit(1);
  return row ?? null;
}

export async function approveCell(args: {
  cellId: string;
  approvedBy: string;
}): Promise<void> {
  await db
    .update(levelExpectations)
    .set({
      approvalState: "approved",
      approvedBy: args.approvedBy,
      approvedAt: new Date(),
      rejectionNotes: null,
      updatedAt: new Date(),
    })
    .where(eq(levelExpectations.id, args.cellId));
}

export async function rejectCell(args: {
  cellId: string;
  rejectionNotes: string;
  rejectedBy: string;
}): Promise<void> {
  await db
    .update(levelExpectations)
    .set({
      approvalState: "rejected",
      rejectionNotes: args.rejectionNotes,
      // Track who rejected via approved_by — same column does double duty
      // for "last touched by"; rejection notes makes the state clear.
      approvedBy: args.rejectedBy,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(levelExpectations.id, args.cellId));
}

/**
 * Inline edit by a human reviewer. PRD §1b — sets `synthesised = false`
 * (a human now owns the text) and `approved` in one step, since the
 * reviewer is the same actor that's already trusted to approve cells.
 */
export async function editCellInline(args: {
  cellId: string;
  expectationText: string;
  editedBy: string;
}): Promise<void> {
  await db
    .update(levelExpectations)
    .set({
      expectationText: args.expectationText,
      synthesised: false,
      approvalState: "approved",
      approvedBy: args.editedBy,
      approvedAt: new Date(),
      rejectionNotes: null,
      updatedAt: new Date(),
    })
    .where(eq(levelExpectations.id, args.cellId));
}

/**
 * Bump regeneration count when sending a cell back to Claude. Caller
 * checks the returned count against MAX_REGENERATIONS_PER_CELL before
 * actually calling Opus.
 */
export async function bumpRegenerationCount(
  cellId: string,
): Promise<number> {
  const [row] = await db
    .update(levelExpectations)
    .set({
      regenerationCount: sql`${levelExpectations.regenerationCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(levelExpectations.id, cellId))
    .returning({ count: levelExpectations.regenerationCount });
  return row?.count ?? 0;
}

export function isRegenerationCapped(count: number): boolean {
  return count >= MAX_REGENERATIONS_PER_CELL;
}

/* ---------- Bulk approve ---------- */

/**
 * Build the approval-state filter used by every bulk-approve helper.
 * When includeRejected is true we also flip rejected cells back to
 * approved — for "I changed my mind about those rejections" workflows.
 * Default is pending-only so existing callers' semantics are unchanged.
 */
function bulkApprovableStateFilter(includeRejected: boolean) {
  return includeRejected
    ? inArray(levelExpectations.approvalState, ["pending", "rejected"] as const)
    : eq(levelExpectations.approvalState, "pending");
}

export async function bulkApproveByTask(args: {
  taskId: string;
  approvedBy: string;
  includeRejected?: boolean;
}): Promise<number> {
  const updated = await db
    .update(levelExpectations)
    .set({
      approvalState: "approved",
      approvedBy: args.approvedBy,
      approvedAt: new Date(),
      rejectionNotes: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(levelExpectations.taskId, args.taskId),
        bulkApprovableStateFilter(args.includeRejected ?? false),
      ),
    )
    .returning({ id: levelExpectations.id });
  return updated.length;
}

export async function bulkApproveBySkill(args: {
  skillId: string;
  approvedBy: string;
  includeRejected?: boolean;
}): Promise<number> {
  // Single SQL with sub-query so we don't fetch the task ids to the app.
  const updated = await db
    .update(levelExpectations)
    .set({
      approvalState: "approved",
      approvedBy: args.approvedBy,
      approvedAt: new Date(),
      rejectionNotes: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        bulkApprovableStateFilter(args.includeRejected ?? false),
        inArray(
          levelExpectations.taskId,
          db
            .select({ id: tasks.id })
            .from(tasks)
            .where(eq(tasks.skillId, args.skillId)),
        ),
      ),
    )
    .returning({ id: levelExpectations.id });
  return updated.length;
}

export async function bulkApproveAllPending(args: {
  skillboardId: string;
  approvedBy: string;
  includeRejected?: boolean;
}): Promise<number> {
  const updated = await db
    .update(levelExpectations)
    .set({
      approvalState: "approved",
      approvedBy: args.approvedBy,
      approvedAt: new Date(),
      rejectionNotes: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        bulkApprovableStateFilter(args.includeRejected ?? false),
        inArray(
          levelExpectations.taskId,
          db
            .select({ id: tasks.id })
            .from(tasks)
            .where(
              inArray(
                tasks.skillId,
                db
                  .select({ id: skills.id })
                  .from(skills)
                  .where(eq(skills.skillboardId, args.skillboardId)),
              ),
            ),
        ),
      ),
    )
    .returning({ id: levelExpectations.id });
  return updated.length;
}

/* ---------- Helpers ---------- */

function cellRowToOutput(c: LevelExpectation): LevelExpectationCell {
  return {
    id: c.id,
    task_id: c.taskId,
    band: c.band,
    level: c.level,
    expectation_text: c.expectationText,
    synthesised: c.synthesised,
    approval_state: c.approvalState,
    approved_by: c.approvedBy,
    approved_at: c.approvedAt?.toISOString() ?? null,
    rejection_notes: c.rejectionNotes,
    regeneration_count: c.regenerationCount,
  };
}

function groupBy<T, K>(arr: T[], key: (item: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = m.get(k);
    if (list) list.push(item);
    else m.set(k, [item]);
  }
  return m;
}
