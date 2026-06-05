/**
 * POST /api/admin/skillboards/upload
 *
 * Excel-upload path for skillboard creation (Phase 1E).
 *
 * Body: multipart/form-data with a single `file` field (xlsx).
 *
 * Pipeline:
 *   1. Parse via parseSkillboardExcel — returns structured errors per
 *      sheet/row if anything is wrong (missing sheets, bad enums,
 *      orphan rows, missing cells, etc.).
 *   2. Refuse if a board with the same specialisation already exists
 *      and is non-orphan (mirrors the claude_authored conflict check).
 *   3. Insert skillboards row, then bulk-insert skills + tasks + cells
 *      with the parsed text — NO Opus calls. Cells default to
 *      approval_state='pending' so a Learning Expert still reviews.
 *
 * Returns 201 with skillboard_id on success, 422 with errors on
 * parse/validation failure, 409 on conflict.
 *
 * Permission: skillboard access (same as claude-authored path).
 */

import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSkillboardAccessApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  levelExpectations,
  skillboards,
  skills,
  tasks,
} from "@/lib/db/schema";
import { parseSkillboardExcel } from "@/lib/engines/assessment/skillboards/excel-parser";
import { createSkillboard } from "@/lib/engines/assessment/skillboards/repository";

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireSkillboardAccessApi();
  if (!auth.user) return auth.unauthorized;

  // ---- 1. Read the uploaded file ----
  let bytes: Uint8Array;
  let filename = "upload.xlsx";
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "no_file", message: "Send an .xlsx file in the 'file' field." },
        { status: 400 },
      );
    }
    filename = file.name || filename;
    const arrayBuf = await file.arrayBuffer();
    bytes = new Uint8Array(arrayBuf);
  } catch (err) {
    return NextResponse.json(
      {
        error: "form_parse_failed",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 400 },
    );
  }

  // ---- 2. Parse ----
  const parsed = parseSkillboardExcel(bytes);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "excel_validation_failed",
        message: `${parsed.errors.length} problem(s) found in ${filename}.`,
        errors: parsed.errors,
      },
      { status: 422 },
    );
  }

  // ---- 3. Conflict check ----
  const [existing] = await db
    .select({ id: skillboards.id, archivedAt: skillboards.archivedAt })
    .from(skillboards)
    .where(
      and(
        eq(skillboards.specialisation, parsed.data.metadata.specialisation),
        isNull(skillboards.archivedAt),
      ),
    )
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error: "specialisation_conflict",
        message: `A non-archived skillboard for '${parsed.data.metadata.specialisation}' already exists. Delete or archive it first.`,
        existing_id: existing.id,
      },
      { status: 409 },
    );
  }

  // ---- 4. Insert skillboard + structure ----
  const board = await createSkillboard({
    specialisation: parsed.data.metadata.specialisation,
    description: parsed.data.metadata.description,
    creationPath: "upload",
    roleFamily: parsed.data.metadata.roleFamily,
    parentSkillboardId: null,
    sourceFiles: [
      {
        kind: "upload",
        filename,
        storage_path: "",
        mime:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });

  // Insert skills.
  const skillIdByOrder = new Map<number, string>();
  for (const s of parsed.data.skills) {
    const [skillRow] = await db
      .insert(skills)
      .values({
        skillboardId: board.id,
        name: s.name,
        orderIndex: s.orderIndex,
      })
      .returning({ id: skills.id });
    skillIdByOrder.set(s.orderIndex, skillRow.id);
  }

  // Insert tasks + cells.
  let totalCells = 0;
  for (const s of parsed.data.skills) {
    const skillId = skillIdByOrder.get(s.orderIndex);
    if (!skillId) continue;
    for (const t of s.tasks) {
      const [taskRow] = await db
        .insert(tasks)
        .values({
          skillId,
          name: t.name,
          orderIndex: t.orderIndex,
        })
        .returning({ id: tasks.id });
      // Bulk insert all 15 cells for this task.
      if (t.cells.length > 0) {
        await db.insert(levelExpectations).values(
          t.cells.map((c) => ({
            taskId: taskRow.id,
            band: c.band,
            level: c.level,
            expectationText: c.expectationText,
            // Excel-authored cells are human-written, not Opus.
            synthesised: false,
            approvalState: "pending" as const,
          })),
        );
        totalCells += t.cells.length;
      }
    }
  }

  return NextResponse.json(
    {
      skillboard_id: board.id,
      skills_created: parsed.data.skills.length,
      tasks_created: parsed.data.skills.reduce(
        (sum, s) => sum + s.tasks.length,
        0,
      ),
      cells_created: totalCells,
      message:
        "Skillboard uploaded. All cells start as 'pending' — review and approve via the detail page before activation.",
    },
    { status: 201 },
  );
}
