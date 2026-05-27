/**
 * AI-scoring visibility flag.
 *
 * Source of truth = the feature_flags row keyed 'ai_scoring_visibility'.
 * The row's `enabled_for_roles` is a text[] of admin roles allowed to
 * see / run AI panels. Superadmins flip this in /admin/settings; no
 * deploy required.
 *
 * Fallback: if the row is missing (fresh deploys before the migration
 * runs), we read AI_SCORING_VISIBLE_TO env and default to ['superadmin'].
 *
 * Assessor rule remains hard-coded: even when 'assessor' is in the list,
 * an assessor only sees AI on a given answer AFTER they've saved their
 * own score on it. That's behaviour doctrine, not config.
 */

import { eq } from "drizzle-orm";

import type { AdminRole } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { featureFlags } from "@/lib/db/schema";

const VALID_ROLES: AdminRole[] = ["superadmin", "admin", "editor", "assessor"];
export const AI_SCORING_FLAG_KEY = "ai_scoring_visibility";
/**
 * Skillboard access — controls who can VIEW/CREATE/EDIT skillboards
 * (rename a board, edit metadata, find-replace, regenerate cells).
 * The approve/activate gate is separate (per-admin can_approve_skillboards
 * boolean = the Learning Expert role). Approving still requires the
 * user to be in the allowed roles here AND have the Learning Expert
 * flag — they're stacked, not OR'd.
 */
export const SKILLBOARD_ACCESS_FLAG_KEY = "skillboard_access";

function parseRoles(values: readonly string[]): AdminRole[] {
  const out = values
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AdminRole => (VALID_ROLES as string[]).includes(s));
  return out.length > 0 ? out : (["superadmin"] as AdminRole[]);
}

/**
 * Load the currently configured set of roles allowed to see AI scores.
 * Server-only — pulls the feature_flags row, falling back to env.
 * Callers pass the returned set into canSeeAiScores / canRunAiPipeline
 * to keep those checks synchronous.
 */
export async function loadAiScoringRoles(): Promise<Set<AdminRole>> {
  try {
    const [row] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, AI_SCORING_FLAG_KEY))
      .limit(1);
    if (row) return new Set(parseRoles(row.enabledForRoles));
  } catch {
    // Table missing or DB unreachable — fall through to env.
  }
  const raw = process.env.AI_SCORING_VISIBLE_TO ?? "superadmin";
  return new Set(parseRoles(raw.split(",")));
}

export function canSeeAiScores(args: {
  role: AdminRole;
  hasOwnScore: boolean;
  allowed: ReadonlySet<AdminRole>;
}): boolean {
  if (args.role === "assessor") {
    if (!args.allowed.has("assessor")) return false;
    return args.hasOwnScore;
  }
  return args.allowed.has(args.role);
}

export function canRunAiPipeline(
  role: AdminRole,
  allowed: ReadonlySet<AdminRole>,
): boolean {
  return allowed.has(role) && role !== "assessor";
}

/* ---------- Skillboard access flag ---------- */

/**
 * Mirrors loadAiScoringRoles for the skillboard_access flag.
 * Fallback (row missing) defaults to ['superadmin'] only — safe.
 */
export async function loadSkillboardAccessRoles(): Promise<Set<AdminRole>> {
  try {
    const [row] = await db
      .select()
      .from(featureFlags)
      .where(eq(featureFlags.key, SKILLBOARD_ACCESS_FLAG_KEY))
      .limit(1);
    if (row) return new Set(parseRoles(row.enabledForRoles));
  } catch {
    // Table missing or DB unreachable — fall through to env.
  }
  const raw = process.env.SKILLBOARD_ACCESS_VISIBLE_TO ?? "superadmin";
  return new Set(parseRoles(raw.split(",")));
}

/**
 * Decision function. Used by the route auth wrapper +
 * client-side helpers (e.g. show/hide nav links).
 */
export function canAccessSkillboards(
  role: AdminRole,
  allowed: ReadonlySet<AdminRole>,
): boolean {
  // Assessors never get skillboard access regardless of flag — the
  // assessor role exists for scoring only; broadening it here would
  // be a footgun.
  if (role === "assessor") return false;
  return allowed.has(role);
}
