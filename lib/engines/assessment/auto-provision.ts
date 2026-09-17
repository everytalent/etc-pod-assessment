/**
 * Automatic skillboard provisioning for a specialisation we do not have.
 *
 * Before this, a candidate whose specialisation had no skillboard was
 * simply turned away: /api/internal/sessions returned
 * `unknown_specialisation` and the PoD told them "we're still setting up
 * validation, we'll email you the moment it's ready." Nothing was being
 * set up. No job existed, no queue entry, nothing to send that email.
 * The candidate waited for an event that could not happen, and the only
 * way out was an admin noticing and authoring the board by hand.
 *
 * PRD §17 already specifies the opposite for the tenant path: an
 * unmatched JD auto-authors a provisional skillboard with no admin in
 * the loop. That machinery existed and was wired only to the tenant
 * builder. This applies the same rule to the candidate path, which is
 * where it matters most, because a candidate cannot paste a JD to
 * describe what they do.
 *
 * What happens when an unknown specialisation arrives:
 *
 *   1. A skillboard row is created immediately. Cheap, no model call.
 *   2. A `structure` job is queued, carrying auto_activate.
 *   3. The authoring worker (5-minute cron) runs the structure pass,
 *      then, because of that flag, activates the board and queues the
 *      bank_seed jobs itself rather than waiting to be activated by
 *      hand.
 *
 * So the request the candidate is waiting on does no model work at all
 * and returns immediately; everything expensive happens on the queue.
 * That matters because this runs inside a request the PoD is blocking
 * on, and because serverless will kill anything still running after the
 * response is sent.
 *
 * Spend is governed by the existing Opus cap: queueing costs nothing,
 * and every job the worker runs already goes through withOpusBudget.
 */

import { and, eq, ilike, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  skillboardAuthoringJobs,
  skillboards,
  type AuthoringJobType,
  type SkillboardRoleFamily,
} from "@/lib/db/schema";
import { findSkillboardForSpecialisation } from "@/lib/engines/assessment/specialisation-matcher";
import { notify } from "@/lib/notify";

export type AutoProvisionResult =
  | { kind: "queued"; skillboardId: string; specialisation: string }
  | { kind: "already_provisioning"; skillboardId: string }
  | { kind: "already_exists"; skillboardId: string }
  | { kind: "rejected"; reason: "implausible_specialisation" };

/**
 * Role-family inference, by keyword rather than by model call.
 *
 * It only picks between three prompt branches, and getting it slightly
 * wrong costs a less well-targeted structure prompt, not a broken
 * board. That is not worth an Opus call on the request path, and the
 * schema's own enum comment already describes O&M as technical.
 */
function inferRoleFamily(specialisation: string): SkillboardRoleFamily {
  const s = specialisation.toLowerCase();

  const bdPm =
    /\b(sales|business development|bd|account|partnership|marketing|customer success|recruit|talent|hr|people|finance|procurement|project manager|programme|program manager|pmo|coordinator|administrat)\b/;
  const technical =
    /\b(engineer|technician|installation|installer|maintenance|o&m|operations|design|electrical|mechanical|solar|pv|inverter|battery|survey|commission|qa|qc|safety|data|software|developer)\b/;

  // Technical wins a tie: a "Solar Sales Engineer" is assessed far
  // better by the technical branch than the commercial one, and the
  // reverse mistake is the more damaging of the two.
  if (technical.test(s)) return "technical";
  if (bdPm.test(s)) return "bd_pm";
  return "technical";
}

/**
 * Guard against turning typos and junk into skillboards.
 *
 * This runs on input that reaches us from a candidate's profile, so it
 * is untrusted. A board is a real object with real Opus spend behind
 * it; anything that does not read like a role name is refused and the
 * caller falls back to the old "not available" behaviour.
 */
function isPlausibleSpecialisation(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 3 || s.length > 120) return false;
  // Must contain at least two consecutive letters, and be mostly
  // letters/spaces/punctuation rather than digits or symbols.
  if (!/[a-z]{2}/i.test(s)) return false;
  const letters = (s.match(/[a-z]/gi) ?? []).length;
  if (letters / s.length < 0.5) return false;
  return true;
}

/**
 * The brief handed to the structure-authoring prompt.
 *
 * A candidate gives us a role label and nothing else, so unlike the
 * tenant path there is no JD to analyse. The structure prompt does its
 * own web search, so the brief's job is to fix the context (African
 * energy sector, ETC's bands) and let the prompt do the rest, rather
 * than to invent detail about this role that nobody told us.
 */
function synthesiseBrief(specialisation: string): string {
  return [
    `Author a skillboard for the specialisation "${specialisation}" as practised in the African energy sector, with Nigeria as the default market unless the role name says otherwise.`,
    ``,
    `This board was created automatically because a candidate declared this specialisation and no skillboard existed for it. There is no job description to work from, only the role name, so ground the skills and tasks in what this role actually does day to day in the field rather than in a generic competency list.`,
    ``,
    `Cover the full span of the role: the routine work it owns, the judgement calls it is trusted with, the tools and standards it uses, the safety and compliance obligations it carries, and the people it has to coordinate with. Tasks must be things a person does and can be observed doing, so that a question can ask whether the candidate could carry one out.`,
  ].join("\n");
}

/**
 * Ensure a usable skillboard is on its way for this specialisation.
 *
 * Idempotent and safe to call on every request: an existing board, or
 * one already being provisioned, short-circuits without queueing
 * anything further.
 */
export async function ensureSkillboardForSpecialisation(
  specialisation: string,
): Promise<AutoProvisionResult> {
  const clean = specialisation.trim();

  if (!isPlausibleSpecialisation(clean)) {
    return { kind: "rejected", reason: "implausible_specialisation" };
  }

  // Someone may have authored this between the caller's lookup and now,
  // and the matcher applies the same normalisation the session route
  // used, so this also catches near-spellings of an existing board.
  const match = await findSkillboardForSpecialisation(clean);
  if (match.kind === "match" && !match.archivedAt) {
    return { kind: "already_exists", skillboardId: match.skillboardId };
  }

  // A board we created earlier for this same label whose structure job
  // has not finished yet. It will not match above, because it has no
  // tasks and is not activated.
  // Discriminated as provisional with no originating tenant: the
  // tenant-builder path always stamps originatingTenantId, so this
  // finds boards from the candidate path only. Using creation_path
  // would have meant an ALTER TYPE migration to add a value, which is
  // not worth it for a flag two existing columns already express.
  const [inFlight] = await db
    .select({ id: skillboards.id })
    .from(skillboards)
    .where(
      and(
        eq(skillboards.provisional, true),
        isNull(skillboards.originatingTenantId),
        ilike(skillboards.specialisation, clean),
        isNull(skillboards.archivedAt),
      ),
    )
    .limit(1);
  if (inFlight) {
    return { kind: "already_provisioning", skillboardId: inFlight.id };
  }

  const [board] = await db
    .insert(skillboards)
    .values({
      specialisation: clean,
      description: `Auto-provisioned after a candidate declared "${clean}" with no existing skillboard.`,
      roleFamily: inferRoleFamily(clean),
      // Claude does author the structure, so this is the accurate
      // existing value; the candidate-path origin is carried by
      // provisional + a null originatingTenantId.
      creationPath: "claude_authored",
      // Lineage marker, not a quality gate (PRD §17): it puts the board
      // in the Learning Expert review queue without making that review
      // a precondition for the candidate getting assessed.
      provisional: true,
      claudeAuthoringBrief: synthesiseBrief(clean),
    })
    .returning({ id: skillboards.id });

  await db.insert(skillboardAuthoringJobs).values({
    skillboardId: board.id,
    jobType: "structure" as AuthoringJobType,
    result: {
      reference_urls: [],
      // Read by processStructureJob: activate the board and queue its
      // bank_seed jobs once the structure lands, instead of parking it
      // until an admin presses activate.
      auto_activate: true,
      auto_provisioned: true,
    },
  });

  // Non-blocking: the candidate is not held up if the notifier is down.
  void notify({
    severity: "info",
    eventType: "skillboard_auto_provisioned",
    payload: {
      skillboard_id: board.id,
      specialisation: clean,
      reason: "candidate declared a specialisation with no skillboard",
    },
  }).catch((err: unknown) => {
    console.warn(`[auto-provision] notify failed: ${String(err)}`);
  });

  console.info(
    `[auto-provision] queued structure authoring for "${clean}" (skillboard ${board.id})`,
  );

  return { kind: "queued", skillboardId: board.id, specialisation: clean };
}

/**
 * Make sure an activated-but-empty skillboard is actually being filled.
 *
 * Structure without questions is the other way a candidate gets turned
 * away: the board exists and is live, but its validation bank has
 * nothing in it, so there is nothing to ask. Three activated boards were
 * in exactly this state (System Design and Project Engineering with 3
 * questions each, Solar Installation with 6) because their seed jobs
 * died against the Opus monthly cap in June and nothing ever re-queued
 * them.
 *
 * Idempotent: if bank_seed work is already queued or running for this
 * board, nothing further is added, so repeated candidate arrivals do
 * not pile up duplicate jobs.
 */
export async function ensureBankForSkillboard(
  skillboardId: string,
): Promise<{ kind: "queued"; jobs: number } | { kind: "already_running" }> {
  const [inFlight] = await db
    .select({ id: skillboardAuthoringJobs.id })
    .from(skillboardAuthoringJobs)
    .where(
      and(
        eq(skillboardAuthoringJobs.skillboardId, skillboardId),
        eq(skillboardAuthoringJobs.jobType, "bank_seed" as AuthoringJobType),
        inArray(skillboardAuthoringJobs.status, ["pending", "in_progress"]),
      ),
    )
    .limit(1);
  if (inFlight) return { kind: "already_running" };

  const { enqueueBankSeedJobs } = await import(
    "@/lib/engines/assessment/skillboards/bank-seed-enqueue"
  );
  const jobs = await enqueueBankSeedJobs(skillboardId);

  console.info(
    `[auto-provision] topped up empty bank for skillboard ${skillboardId}: ${jobs} job(s)`,
  );

  return { kind: "queued", jobs };
}
