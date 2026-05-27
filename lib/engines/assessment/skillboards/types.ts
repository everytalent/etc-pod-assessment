/**
 * Skillboard service — input validators + result types.
 *
 * Every API route, every UI form, every Claude-authoring call validates
 * against schemas here. Errors surfaced at the boundary; downstream
 * code (repository, activator, authoring) trusts the shapes.
 */

import { z } from "zod";

import type {
  ApprovalState,
  PerformanceLevel,
  SeniorityBand,
  SkillboardBehaviouralSkill,
  SkillboardCreationPath,
  SkillboardMindset,
  SkillboardRoleFamily,
} from "@/lib/db/schema";

/* ---------- Inputs ---------- */

/**
 * Body for POST /api/admin/skillboards when `creation_path = 'upload'`.
 * The uploaded files arrive multipart; this schema validates the
 * metadata payload sent alongside.
 */
export const createSkillboardUploadInputSchema = z.object({
  creation_path: z.literal("upload"),
  specialisation: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(""),
  role_family: z.enum(["technical", "bd_pm", "hybrid"]).default("technical"),
  parent_skillboard_id: z.string().uuid().optional(),
});

/**
 * Body for POST /api/admin/skillboards when `creation_path = 'claude_authored'`.
 *
 * The brief is intentionally bounded — short, specific briefs produce
 * better skillboards than verbose ones. Reference URLs are capped at 5;
 * Claude can web-search the rest if needed.
 */
export const createSkillboardClaudeInputSchema = z.object({
  creation_path: z.literal("claude_authored"),
  specialisation: z.string().trim().min(1).max(120),
  /**
   * 1-3 sentences. PRD §1a — brief is the Claude-authoring prompt
   * input, also persisted on the row for audit.
   */
  description: z.string().trim().min(20).max(2000),
  /**
   * Drives the Senior-tier framing in cell-pass authoring. Required at
   * create-time so we don't have to retrofit a default later.
   */
  role_family: z.enum(["technical", "bd_pm", "hybrid"]),
  reference_urls: z
    .array(z.string().url().max(500))
    .max(5)
    .default([]),
  parent_skillboard_id: z.string().uuid().optional(),
});

export const createSkillboardInputSchema = z.discriminatedUnion(
  "creation_path",
  [createSkillboardUploadInputSchema, createSkillboardClaudeInputSchema],
);
export type CreateSkillboardInput = z.infer<typeof createSkillboardInputSchema>;

export const patchSkillboardInputSchema = z.object({
  description: z.string().trim().max(2000).optional(),
  mindsets: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).default(""),
      }),
    )
    .max(20)
    .optional(),
  behavioural_skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(500).default(""),
      }),
    )
    .max(20)
    .optional(),
  parent_skillboard_id: z.string().uuid().nullable().optional(),
});
export type PatchSkillboardInput = z.infer<typeof patchSkillboardInputSchema>;

export const patchLevelExpectationInputSchema = z.object({
  /**
   * New expectation text. Required when editing — empty strings clear
   * a cell, but the cell is still considered authored (not pending).
   */
  expectation_text: z.string().trim().min(1).max(2000),
});
export type PatchLevelExpectationInput = z.infer<
  typeof patchLevelExpectationInputSchema
>;

export const rejectCellInputSchema = z.object({
  /**
   * Required so the regeneration prompt can include the reviewer's
   * specific concern. Bare "Reject" with no notes is disallowed —
   * the reviewer must say *why*.
   */
  rejection_notes: z.string().trim().min(20).max(1000),
});
export type RejectCellInput = z.infer<typeof rejectCellInputSchema>;

export const bulkApproveInputSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("row"), task_id: z.string().uuid() }),
  z.object({ scope: z.literal("skill"), skill_id: z.string().uuid() }),
  z.object({ scope: z.literal("all") }),
]);
export type BulkApproveInput = z.infer<typeof bulkApproveInputSchema>;

/* ---------- Outputs (read shapes) ---------- */

/**
 * Cell row enriched with parent context — what the admin UI needs to
 * render one of the 15-cell rows.
 */
export type LevelExpectationCell = {
  id: string;
  task_id: string;
  band: SeniorityBand;
  level: PerformanceLevel;
  expectation_text: string;
  synthesised: boolean;
  approval_state: ApprovalState;
  approved_by: string | null;
  approved_at: string | null;
  rejection_notes: string | null;
  regeneration_count: number;
};

export type TaskWithCells = {
  id: string;
  name: string;
  order_index: number;
  cells: LevelExpectationCell[];
};

export type SkillWithTasks = {
  id: string;
  name: string;
  order_index: number;
  tasks: TaskWithCells[];
};

export type SkillboardDetail = {
  id: string;
  specialisation: string;
  description: string;
  version: number;
  mindsets: SkillboardMindset[];
  behavioural_skills: SkillboardBehaviouralSkill[];
  parent_skillboard_id: string | null;
  creation_path: SkillboardCreationPath;
  role_family: SkillboardRoleFamily;
  claude_authoring_brief: string | null;
  activated_at: string | null;
  /** Counts derived from level_expectations for the activation banner. */
  cell_counts: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  skills: SkillWithTasks[];
};

export type SkillboardListRow = {
  id: string;
  specialisation: string;
  creation_path: SkillboardCreationPath;
  role_family: SkillboardRoleFamily;
  activated_at: string | null;
  cells_pending: number;
  cells_total: number;
  updated_at: string;
};

/* ---------- Constants ---------- */

/** Cap on per-cell regeneration attempts (PRD edge case: runaway loops). */
export const MAX_REGENERATIONS_PER_CELL = 3;

/** Min reasoning length for an override of `band`, `hire`, or `scopes`. */
export const MIN_OVERRIDE_REASONING_CHARS = 20;
