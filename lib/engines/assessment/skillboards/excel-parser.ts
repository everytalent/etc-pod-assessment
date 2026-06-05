/**
 * Excel parser for the upload-skillboard path.
 *
 * Expected workbook shape (the canonical template ETC's L&D team uses):
 *
 *   Sheet "Metadata":
 *     | Field           | Value                            |
 *     | specialisation  | Solar Sales Specialist           |
 *     | description     | ...                              |
 *     | role_family     | technical | bd_pm | hybrid       |
 *
 *   Sheet "Skills":
 *     | order | skill                                       |
 *     | 1     | Solar Product & Technical Literacy          |
 *     | 2     | Customer Discovery                          |
 *     | ...                                                 |
 *
 *   Sheet "Tasks":
 *     | skill_order | task_order | task                                       |
 *     | 1           | 1          | Translate a client's load profile…         |
 *
 *   Sheet "Cells":
 *     | skill_order | task_order | band   | level | expectation_text   |
 *     | 1           | 1          | junior | below | Cannot convert…    |
 *
 * The parser is forgiving about column case + whitespace but strict
 * about value enums (band, level, role_family). Returns either a
 * fully-validated payload OR a list of structured errors so the UI
 * can show line-by-line feedback.
 */

import * as XLSX from "xlsx";

import type {
  PerformanceLevel,
  SeniorityBand,
  SkillboardRoleFamily,
} from "@/lib/db/schema";

export type ParsedSkillboard = {
  metadata: {
    specialisation: string;
    description: string;
    roleFamily: SkillboardRoleFamily;
  };
  skills: Array<{
    name: string;
    orderIndex: number;
    tasks: Array<{
      name: string;
      orderIndex: number;
      cells: Array<{
        band: SeniorityBand;
        level: PerformanceLevel;
        expectationText: string;
      }>;
    }>;
  }>;
};

export type ParseError = {
  sheet: string;
  row?: number;
  column?: string;
  message: string;
};

export type ParseResult =
  | { ok: true; data: ParsedSkillboard }
  | { ok: false; errors: ParseError[] };

const VALID_BANDS: SeniorityBand[] = ["junior", "mid", "senior"];
const VALID_LEVELS: PerformanceLevel[] = ["below", "nh", "g", "p", "tp"];
const VALID_ROLE_FAMILIES: SkillboardRoleFamily[] = [
  "technical",
  "bd_pm",
  "hybrid",
];

export function parseSkillboardExcel(
  fileBytes: ArrayBuffer | Uint8Array,
): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fileBytes, { type: "array" });
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          sheet: "(workbook)",
          message: `Could not open file as Excel: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        },
      ],
    };
  }

  const errors: ParseError[] = [];

  // ---- Metadata sheet ----
  const metaSheet = pickSheet(wb, ["metadata", "meta"]);
  if (!metaSheet) {
    errors.push({
      sheet: "Metadata",
      message: "Missing required sheet 'Metadata' (or 'Meta').",
    });
  }

  const metaMap = metaSheet ? sheetToFieldValueMap(metaSheet) : new Map();
  const specialisation = String(metaMap.get("specialisation") ?? "").trim();
  const description = String(metaMap.get("description") ?? "").trim();
  const roleFamilyRaw = String(metaMap.get("role_family") ?? "").trim().toLowerCase();
  if (specialisation.length < 3) {
    errors.push({
      sheet: "Metadata",
      message: "specialisation must be at least 3 characters.",
    });
  }
  if (
    !VALID_ROLE_FAMILIES.includes(roleFamilyRaw as SkillboardRoleFamily)
  ) {
    errors.push({
      sheet: "Metadata",
      message: `role_family must be one of: ${VALID_ROLE_FAMILIES.join(", ")} (got '${roleFamilyRaw}')`,
    });
  }

  // ---- Skills sheet ----
  const skillsSheet = pickSheet(wb, ["skills", "skill"]);
  if (!skillsSheet) {
    errors.push({
      sheet: "Skills",
      message: "Missing required sheet 'Skills'.",
    });
  }
  const skillRows = skillsSheet ? sheetToRows(skillsSheet) : [];
  const skillByOrder = new Map<
    number,
    { name: string; orderIndex: number; tasks: ParsedSkillboard["skills"][number]["tasks"] }
  >();
  skillRows.forEach((row, i) => {
    const order = toInt(row["order"] ?? row["skill_order"]);
    const name = String(row["skill"] ?? row["name"] ?? "").trim();
    if (order === null || name.length === 0) {
      errors.push({
        sheet: "Skills",
        row: i + 2,
        message: "Each row needs an integer 'order' and a non-empty 'skill'.",
      });
      return;
    }
    if (skillByOrder.has(order)) {
      errors.push({
        sheet: "Skills",
        row: i + 2,
        message: `Duplicate skill order ${order}.`,
      });
      return;
    }
    skillByOrder.set(order, { name, orderIndex: order - 1, tasks: [] });
  });

  // ---- Tasks sheet ----
  const tasksSheet = pickSheet(wb, ["tasks", "task"]);
  if (!tasksSheet) {
    errors.push({
      sheet: "Tasks",
      message: "Missing required sheet 'Tasks'.",
    });
  }
  const taskRows = tasksSheet ? sheetToRows(tasksSheet) : [];
  type TaskKey = string; // `${skillOrder}.${taskOrder}`
  const taskByKey = new Map<
    TaskKey,
    { skillOrder: number; taskOrder: number; name: string }
  >();
  taskRows.forEach((row, i) => {
    const skillOrder = toInt(row["skill_order"] ?? row["skill"]);
    const taskOrder = toInt(row["task_order"] ?? row["order"]);
    const name = String(row["task"] ?? row["name"] ?? "").trim();
    if (skillOrder === null || taskOrder === null || name.length === 0) {
      errors.push({
        sheet: "Tasks",
        row: i + 2,
        message:
          "Each row needs integer 'skill_order' and 'task_order' and a non-empty 'task'.",
      });
      return;
    }
    if (!skillByOrder.has(skillOrder)) {
      errors.push({
        sheet: "Tasks",
        row: i + 2,
        message: `Task references unknown skill_order ${skillOrder}.`,
      });
      return;
    }
    const key = `${skillOrder}.${taskOrder}`;
    if (taskByKey.has(key)) {
      errors.push({
        sheet: "Tasks",
        row: i + 2,
        message: `Duplicate task ${key}.`,
      });
      return;
    }
    taskByKey.set(key, { skillOrder, taskOrder, name });
  });

  // ---- Cells sheet ----
  const cellsSheet = pickSheet(wb, ["cells", "cell", "expectations"]);
  if (!cellsSheet) {
    errors.push({
      sheet: "Cells",
      message: "Missing required sheet 'Cells'.",
    });
  }
  const cellRows = cellsSheet ? sheetToRows(cellsSheet) : [];
  type CellKey = string; // `${skillOrder}.${taskOrder}.${band}.${level}`
  const cellByKey = new Map<
    CellKey,
    { band: SeniorityBand; level: PerformanceLevel; text: string }
  >();
  cellRows.forEach((row, i) => {
    const skillOrder = toInt(row["skill_order"]);
    const taskOrder = toInt(row["task_order"]);
    const band = String(row["band"] ?? "").trim().toLowerCase() as SeniorityBand;
    const level = String(row["level"] ?? "").trim().toLowerCase() as PerformanceLevel;
    const text = String(
      row["expectation_text"] ?? row["text"] ?? row["expectation"] ?? "",
    ).trim();

    if (skillOrder === null || taskOrder === null) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: "skill_order and task_order are required integers.",
      });
      return;
    }
    if (!VALID_BANDS.includes(band)) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: `band must be one of: ${VALID_BANDS.join(", ")} (got '${band}')`,
      });
      return;
    }
    if (!VALID_LEVELS.includes(level)) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: `level must be one of: ${VALID_LEVELS.join(", ")} (got '${level}')`,
      });
      return;
    }
    if (text.length < 20) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: "expectation_text must be at least 20 characters.",
      });
      return;
    }
    const taskKey = `${skillOrder}.${taskOrder}`;
    if (!taskByKey.has(taskKey)) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: `Cell references unknown task ${taskKey}.`,
      });
      return;
    }
    const key = `${skillOrder}.${taskOrder}.${band}.${level}`;
    if (cellByKey.has(key)) {
      errors.push({
        sheet: "Cells",
        row: i + 2,
        message: `Duplicate cell ${key}.`,
      });
      return;
    }
    cellByKey.set(key, { band, level, text });
  });

  // Stitch + validate coverage: every task must have 15 cells (3 bands × 5 levels).
  if (errors.length === 0) {
    for (const t of taskByKey.values()) {
      const cellsForTask: Array<{
        band: SeniorityBand;
        level: PerformanceLevel;
        expectationText: string;
      }> = [];
      for (const band of VALID_BANDS) {
        for (const level of VALID_LEVELS) {
          const key = `${t.skillOrder}.${t.taskOrder}.${band}.${level}`;
          const cell = cellByKey.get(key);
          if (!cell) {
            errors.push({
              sheet: "Cells",
              message: `Missing cell ${key} — task ${t.taskOrder} of skill ${t.skillOrder} (${t.name}) is incomplete. Every task needs all 15 cells.`,
            });
          } else {
            cellsForTask.push({
              band: cell.band,
              level: cell.level,
              expectationText: cell.text,
            });
          }
        }
      }
      const skill = skillByOrder.get(t.skillOrder);
      if (skill) {
        skill.tasks.push({
          name: t.name,
          orderIndex: t.taskOrder - 1,
          cells: cellsForTask,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Sort tasks within each skill by orderIndex.
  for (const skill of skillByOrder.values()) {
    skill.tasks.sort((a, b) => a.orderIndex - b.orderIndex);
  }
  const skillsList = Array.from(skillByOrder.values()).sort(
    (a, b) => a.orderIndex - b.orderIndex,
  );

  return {
    ok: true,
    data: {
      metadata: {
        specialisation,
        description,
        roleFamily: roleFamilyRaw as SkillboardRoleFamily,
      },
      skills: skillsList,
    },
  };
}

/* ---------- Internal helpers ---------- */

function pickSheet(
  wb: XLSX.WorkBook,
  candidateNames: string[],
): XLSX.WorkSheet | null {
  const lower = new Set(candidateNames.map((n) => n.toLowerCase()));
  for (const name of wb.SheetNames) {
    if (lower.has(name.toLowerCase())) return wb.Sheets[name];
  }
  return null;
}

function sheetToFieldValueMap(
  sheet: XLSX.WorkSheet,
): Map<string, string | number | boolean | null> {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  const map = new Map<string, string | number | boolean | null>();
  for (const r of rows) {
    const keys = Object.keys(r);
    if (keys.length < 2) continue;
    const k = String(r[keys[0]] ?? "").trim().toLowerCase();
    const v = r[keys[1]] as string | number | boolean | null;
    if (k.length > 0) map.set(k, v);
  }
  return map;
}

function sheetToRows(sheet: XLSX.WorkSheet): Array<Record<string, unknown>> {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  // Normalise header keys to lowercase so the parser doesn't care about
  // "Skill" vs "skill" vs "SKILL".
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      out[k.trim().toLowerCase()] = v;
    }
    return out;
  });
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}
