/**
 * Skillboard feedback corpus — accumulated reviewer rejection notes
 * fed back into Opus prompts so the brief learns automatically.
 *
 * Append sites:
 *   - lib/engines/assessment/skillboards/repository.ts rejectCell()
 *   - app/api/admin/question-bank-proposals/[id]/route.ts (reject action)
 *
 * Read sites:
 *   - lib/engines/assessment/skillboards/prompts.ts (structure + cell regen)
 *   - lib/engines/assessment/proposals/opus-seed.ts (bank seed)
 *   - new proposal_regeneration job handler
 *
 * The corpus is capped at MAX_ENTRIES per skillboard (newest kept).
 * Oldest entries are dropped silently so the prompt context doesn't
 * blow up over time. Admins can curate manually via the skillboard
 * edit panel if needed.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  skillboards,
  type SkillboardFeedbackEntry,
} from "@/lib/db/schema";

const MAX_ENTRIES = 50;

export async function appendFeedbackNote(
  skillboardId: string,
  entry: SkillboardFeedbackEntry,
): Promise<void> {
  const [row] = await db
    .select({ feedbackNotes: skillboards.feedbackNotes })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!row) return;
  const current = row.feedbackNotes ?? [];
  const next: SkillboardFeedbackEntry[] = [...current, entry].slice(-MAX_ENTRIES);
  await db
    .update(skillboards)
    .set({ feedbackNotes: next, updatedAt: new Date() })
    .where(eq(skillboards.id, skillboardId));
}

/**
 * Look up the parent skillboard.id for any cell or proposal so the
 * reject paths can call appendFeedbackNote() with a single helper.
 */
export async function skillboardIdForTask(
  taskId: string,
): Promise<string | null> {
  const { tasks, skills } = await import("@/lib/db/schema");
  const [row] = await db
    .select({ skillboardId: skills.skillboardId })
    .from(tasks)
    .innerJoin(skills, eq(skills.id, tasks.skillId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.skillboardId ?? null;
}

export async function skillboardIdForSpecialisation(
  specialisation: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: skillboards.id })
    .from(skillboards)
    .where(eq(skillboards.specialisation, specialisation))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Build the "Past reviewer feedback to address" prompt section. Empty
 * string when the corpus is empty (so prompts don't emit a useless
 * header). The first line is a directive; subsequent lines list the
 * notes newest-first.
 */
export async function buildFeedbackContextBlock(
  skillboardId: string,
): Promise<string> {
  const [row] = await db
    .select({ feedbackNotes: skillboards.feedbackNotes })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  const notes = row?.feedbackNotes ?? [];
  if (notes.length === 0) return "";

  // Show newest first, cap displayed at 20 to keep the prompt tight.
  const visible = [...notes].reverse().slice(0, 20);
  const lines = visible.map((n, i) => {
    const ctx = n.context ? ` (${n.context})` : "";
    return `${i + 1}. [${n.source}]${ctx}: ${n.notes.trim()}`;
  });
  return `\nPast reviewer feedback to address — apply these lessons proactively in this output. Do not repeat the same mistakes:\n${lines.join("\n")}\n`;
}
