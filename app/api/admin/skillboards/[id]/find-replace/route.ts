/**
 * POST /api/admin/skillboards/[id]/find-replace
 *
 * Text find-and-replace across level_expectation cells under a scope.
 *
 * Two modes via body:
 *   { mode: 'preview', find, replace_with?, scope, case_sensitive? }
 *     → returns matches WITHOUT mutating, so the UI can show diffs
 *
 *   { mode: 'apply', find, replace_with, scope, case_sensitive? }
 *     → applies the replacement, auto-approves edited cells (same
 *       semantics as inline edit), marks them as human-authored.
 *
 * Scope:
 *   { kind: 'task', task_id }
 *   { kind: 'skill', skill_id }
 *   { kind: 'board' }
 *
 * Permission: Learning Expert.
 */

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSkillboardApproverApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { levelExpectations, skills, tasks } from "@/lib/db/schema";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), task_id: z.string().uuid() }),
  z.object({ kind: z.literal("skill"), skill_id: z.string().uuid() }),
  z.object({ kind: z.literal("board") }),
]);

const inputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("preview"),
    find: z.string().min(1).max(500),
    replace_with: z.string().max(500).optional(),
    scope: scopeSchema,
    case_sensitive: z.boolean().default(false),
  }),
  z.object({
    mode: z.literal("apply"),
    find: z.string().min(1).max(500),
    replace_with: z.string().max(500),
    scope: scopeSchema,
    case_sensitive: z.boolean().default(false),
  }),
]);

type PreviewMatch = {
  cell_id: string;
  task_id: string;
  band: string;
  level: string;
  current_text: string;
  preview_text: string;
  match_count: number;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireSkillboardApproverApi();
  if (!auth.user) return auth.unauthorized;

  const { id: skillboardId } = await context.params;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Resolve task ids in scope.
  let taskIds: string[] = [];
  if (input.scope.kind === "task") {
    taskIds = [input.scope.task_id];
  } else if (input.scope.kind === "skill") {
    const tRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.skillId, input.scope.skill_id));
    taskIds = tRows.map((t) => t.id);
  } else {
    const tRows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(skills, eq(skills.id, tasks.skillId))
      .where(eq(skills.skillboardId, skillboardId));
    taskIds = tRows.map((t) => t.id);
  }
  if (taskIds.length === 0) {
    return NextResponse.json({ matches: [], updated: 0 });
  }

  // Load cells in scope.
  const cells = await db
    .select({
      id: levelExpectations.id,
      taskId: levelExpectations.taskId,
      band: levelExpectations.band,
      level: levelExpectations.level,
      text: levelExpectations.expectationText,
    })
    .from(levelExpectations)
    .where(inArray(levelExpectations.taskId, taskIds));

  // Build a regex from the find string. Escape regex metacharacters so
  // "C.B.N." matches literally, not "C anything B anything N anything".
  const flags = input.case_sensitive ? "g" : "gi";
  const escaped = input.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, flags);

  const matches: PreviewMatch[] = [];
  for (const c of cells) {
    if (!c.text) continue;
    const count = c.text.match(re)?.length ?? 0;
    if (count === 0) continue;
    const previewText =
      input.mode === "preview"
        ? c.text.replace(re, input.replace_with ?? "")
        : c.text.replace(re, input.replace_with);
    matches.push({
      cell_id: c.id,
      task_id: c.taskId,
      band: c.band,
      level: c.level,
      current_text: c.text,
      preview_text: previewText,
      match_count: count,
    });
  }

  if (input.mode === "preview") {
    return NextResponse.json({
      matches,
      total_matches: matches.reduce((sum, m) => sum + m.match_count, 0),
      cells_affected: matches.length,
    });
  }

  // Apply mode — UPDATE each matched cell, auto-approve.
  if (matches.length === 0) {
    return NextResponse.json({ updated: 0 });
  }
  const now = new Date();
  // Could do this in a single SQL UPDATE with CASE/WHEN, but the loop
  // is clearer and each row already has bounded payload (<400 chars).
  for (const m of matches) {
    await db
      .update(levelExpectations)
      .set({
        expectationText: m.preview_text,
        synthesised: false, // human edit
        approvalState: "approved",
        approvedBy: auth.session.admin.id,
        approvedAt: now,
        rejectionNotes: null,
        updatedAt: now,
      })
      .where(eq(levelExpectations.id, m.cell_id));
  }

  return NextResponse.json({
    updated: matches.length,
    total_replacements: matches.reduce((sum, m) => sum + m.match_count, 0),
  });
  // Reference `and` so the import isn't unused if scopes change later.
  void and;
}
