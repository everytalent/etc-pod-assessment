/**
 * Feature flag for AI scoring visibility — env-driven so the rollout
 * (superadmin only → admins/editors after 1 month) is one Netlify env
 * change away. No DB migration, no admin UI yet.
 *
 * Format: AI_SCORING_VISIBLE_TO is a comma-separated list of role names.
 * Default if unset: only superadmin can see AI panels.
 *
 * Assessor rule is hard-coded because it isn't really a config — the
 * "see AI only after you've scored" behaviour is part of the assessment
 * doctrine, not an experiment knob.
 */

import type { AdminRole } from "@/lib/auth/admin";

const VALID_ROLES: AdminRole[] = ["superadmin", "admin", "editor", "assessor"];

function visibleRoles(): Set<AdminRole> {
  const raw = process.env.AI_SCORING_VISIBLE_TO ?? "superadmin";
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is AdminRole => (VALID_ROLES as string[]).includes(s));
  return new Set(parsed.length > 0 ? parsed : (["superadmin"] as AdminRole[]));
}

/**
 * Can `role` see AI score panels for this answer?
 *
 *   - superadmin (and anyone in the env list) → always.
 *   - assessor → only if they've already saved their own score on this
 *     specific answer (`hasOwnScore` true).
 *   - everyone else → only if their role is in the env list.
 */
export function canSeeAiScores(args: {
  role: AdminRole;
  hasOwnScore: boolean;
}): boolean {
  const allowed = visibleRoles();
  if (args.role === "assessor") {
    // Assessors are gated on completing their own grade. The env flag
    // can include 'assessor' to enable the post-grade reveal; if not
    // listed, they never see AI even after grading.
    if (!allowed.has("assessor")) return false;
    return args.hasOwnScore;
  }
  return allowed.has(args.role);
}

/** True if the current role can run the cross-check pipeline button. */
export function canRunAiPipeline(role: AdminRole): boolean {
  return visibleRoles().has(role) && role !== "assessor";
}
