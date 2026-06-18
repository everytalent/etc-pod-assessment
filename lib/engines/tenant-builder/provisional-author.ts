/**
 * Provisional framework author — when the matcher returns matched=false,
 * create a new skillboard row scoped to the originating tenant with
 * `provisional = true` + the originating tenant id, then populate its
 * structure (skills/tasks/cells) via the existing claude-author
 * runStructureAuthoring helper.
 *
 * Lineage:
 *   - creationPath = 'tenant_builder'
 *   - derivedFrom  = the candidate skillboard ids the matcher considered
 *   - originatingTenantId = the requesting tenant
 *
 * Runtime behaviour is identical to a Learning-Expert-authored row
 * (PRD principle 3: `provisional` is a lineage marker, not a quality
 * gate). The Learning Expert queue uses the flag to find rows for
 * review; nothing else branches on it.
 *
 * The structure pass runs SYNCHRONOUSLY in the worker (5-10 seconds).
 * Cells remain pending (empty expectation text) for the LE review queue
 * to fill — the question generator doesn't actually read cell text in
 * Phase 2b, so this still produces a usable bank.
 */

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db/client";
import {
  skillboards,
  type SkillboardRoleFamily,
} from "@/lib/db/schema";
import { runStructureAuthoring } from "@/lib/engines/assessment/skillboards/claude-author";
import { notify } from "@/lib/notify";

import type { IntakeAnalysis } from "./intake-analyser";

/**
 * Roughly classify a role into the existing role-family enum so the
 * structure prompt branches correctly. Conservative default: technical.
 */
function inferRoleFamily(analysis: IntakeAnalysis): SkillboardRoleFamily {
  const text = [
    analysis.specialisation_guess,
    ...analysis.core_skills,
  ]
    .join(" ")
    .toLowerCase();
  const bdHits = /sales|business development|account|portfolio|client|commercial|pricing|partnership/.test(
    text,
  );
  const techHits = /install|design|wiring|inverter|wiring|maintenance|diagnose|sop|engineer|operations/.test(
    text,
  );
  if (bdHits && techHits) return "hybrid";
  if (bdHits) return "bd_pm";
  return "technical";
}

/**
 * Build a one-shot brief from the intake analysis. This becomes the
 * skillboard's claudeAuthoringBrief that the structure prompt reads.
 */
function synthesiseBrief(analysis: IntakeAnalysis): string {
  const lines: string[] = [];
  lines.push(`Specialisation: ${analysis.specialisation_guess}`);
  if (analysis.seniority_hint) {
    lines.push(`Seniority emphasis: ${analysis.seniority_hint}`);
  }
  lines.push("");
  lines.push("Core day-to-day skills:");
  for (const s of analysis.core_skills) lines.push(`- ${s}`);
  if (analysis.tools.length > 0) {
    lines.push("");
    lines.push("Named tools / standards:");
    for (const t of analysis.tools) lines.push(`- ${t}`);
  }
  if (analysis.region_cues.length > 0) {
    lines.push("");
    lines.push("Region cues:");
    for (const r of analysis.region_cues) lines.push(`- ${r}`);
  }
  if (analysis.project_scope) {
    lines.push("");
    lines.push("Project scope:");
    if (analysis.project_scope.duration_label) {
      lines.push(`- Duration: ${analysis.project_scope.duration_label}`);
    }
    if (analysis.project_scope.team_size) {
      lines.push(`- Team size: ${analysis.project_scope.team_size}`);
    }
    for (const d of analysis.project_scope.key_deliverables) {
      lines.push(`- Deliverable: ${d}`);
    }
  }
  lines.push("");
  lines.push(`Summary: ${analysis.summary}`);
  return lines.join("\n");
}

export type ProvisionalCreateResult = {
  skillboardId: string;
  /** Human-readable name. The orchestrator passes this downstream to
   *  prompt builders and assessment titles. The stored skillboards
   *  row carries the same name plus a uniqueness suffix that stays
   *  internal. */
  specialisation: string;
};

export async function createProvisionalFramework(args: {
  analysis: IntakeAnalysis;
  tenantId: string;
  derivedFromIds: string[];
}): Promise<ProvisionalCreateResult> {
  const brief = synthesiseBrief(args.analysis);
  const roleFamily = inferRoleFamily(args.analysis);

  // skillboards.specialisation is a UNIQUE column. The matcher might
  // reject an existing master board as a poor fit AND we'd still end
  // up colliding on insert when we try to author the provisional under
  // the same name. Scope provisional names by tenant + a short random
  // tag so multiple tenants, master boards, and retries by the same
  // tenant for the same role can coexist without stomping on each
  // other. The brief / specialisation_guess inside the framework
  // structure preserves the human-readable name; this suffix is purely
  // a uniqueness key.
  const tenantSuffix = args.tenantId.split("-")[0];
  const randomTag = randomUUID().slice(0, 8);
  const baseSpecialisation = args.analysis.specialisation_guess;
  const provisionalSpecialisation = `${baseSpecialisation} (tenant:${tenantSuffix} · ${randomTag})`;

  const [board] = await db
    .insert(skillboards)
    .values({
      // Stored name includes the uniqueness suffix. Never surface this
      // to candidates, emails, or assessment titles — use the clean
      // baseSpecialisation in the result for those.
      specialisation: provisionalSpecialisation,
      description: args.analysis.summary,
      creationPath: "tenant_builder",
      roleFamily,
      claudeAuthoringBrief: brief,
      provisional: true,
      originatingTenantId: args.tenantId,
      derivedFrom: args.derivedFromIds,
    })
    .returning({
      id: skillboards.id,
      specialisation: skillboards.specialisation,
    });

  // Populate structure synchronously. Pass the CLEAN base name to the
  // structure prompt so Opus reasons about "Recruitment Consultant",
  // not "Recruitment Consultant (tenant:e938a03d · fbeb4a4f)" — the
  // suffix is purely a DB uniqueness key and confuses any model
  // prompt that looks at it.
  await runStructureAuthoring({
    skillboardId: board.id,
    args: {
      specialisation: baseSpecialisation,
      brief,
    },
  });

  // Non-blocking LE notification (PRD §1, §2).
  try {
    await notify({
      severity: "info",
      eventType: "tenant_provisional_framework_created",
      payload: {
        skillboard_id: board.id,
        specialisation: board.specialisation,
        originating_tenant_id: args.tenantId,
        derived_from: args.derivedFromIds,
      },
    });
  } catch {
    // Don't fail the build if notify is misconfigured.
  }

  return {
    skillboardId: board.id,
    specialisation: baseSpecialisation,
  };
}
