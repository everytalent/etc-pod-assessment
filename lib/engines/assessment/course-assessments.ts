/**
 * Course assessments: the final assessment of a Training Engine course.
 *
 * Training sends the course's job parts (role, task, what they can do,
 * band). This engine maps the course to an existing activated
 * skillboard when one fits a role, and otherwise creates one from the
 * job parts, with lineage to any boards it nearly matched, and queues
 * its structure authoring with auto-activate, the same path a
 * candidate's unknown specialisation takes. A learner's session is a
 * validation-bank response on that board, minted without an onboarding
 * profile (Training owns the person), and the result is read back by
 * Training rather than pushed, so no new secret crosses the boundary.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  assessments,
  questions,
  responses,
  skillboardAuthoringJobs,
  skillboards,
  type AuthoringJobType,
  type ResponseMetadata,
  type SkillboardRoleFamily,
} from "@/lib/db/schema";
import { findSkillboardForSpecialisation } from "@/lib/engines/assessment/specialisation-matcher";
import { getOrCreateValidationBank } from "@/lib/engines/assessment/proposals/validation-bank";
import { ensureBankForSkillboard } from "@/lib/engines/assessment/auto-provision";

export interface JobPart {
  role: string;
  task: string;
  can_do: string;
  band: "new_hire" | "growing" | "pro";
}

export interface CommissionInput {
  course_ref: string;
  course_name: string;
  description: string;
  job_parts: JobPart[];
}

export type CommissionResult = {
  skillboard_id: string;
  specialisation: string;
  mapped: boolean;
  related_skillboard_ids: string[];
  match_trace: Array<{ role: string; matched: string | null; strategy: string; activated: boolean }>;
};

function inferRoleFamily(text: string): SkillboardRoleFamily {
  const s = text.toLowerCase();
  const bdPm = /\b(sales|business development|account|partnership|marketing|customer success|recruit|talent|hr|finance|procurement|project manager|programme|program manager|coordinator|administrat)\b/;
  const technical = /\b(engineer|technician|installation|installer|maintenance|o&m|operations|design|electrical|mechanical|solar|pv|inverter|battery|survey|commission|safety|data|software)\b/;
  if (technical.test(s)) return "technical";
  if (bdPm.test(s)) return "bd_pm";
  return "technical";
}

function briefFromCourse(input: CommissionInput, specialisation: string): string {
  const byRole = new Map<string, JobPart[]>();
  for (const p of input.job_parts) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role)!.push(p);
  }
  const lines = Array.from(byRole.entries()).map(
    ([role, parts]) => `${role}: ${parts.map((p) => `${p.task}${p.can_do ? ` (${p.can_do})` : ""} [${p.band}]`).join("; ")}`,
  );
  return [
    `Author a skillboard for "${specialisation}" as practised in the African energy sector, Nigeria by default.`,
    ``,
    `This board is the final assessment of the Energy Talent Co course "${input.course_name}". ${input.description.slice(0, 600)}`,
    ``,
    `The course prepares people for these roles and tasks; the skills and tasks on the board must cover them, at the bands given (new_hire, growing, pro), and may add the routine work, judgement calls, tools, standards and safety obligations those roles carry:`,
    ...lines.map((l) => `- ${l}`),
    ``,
    `Tasks must be things a person does and can be observed doing, so a question can ask whether the learner could carry one out.`,
  ].join("\n");
}

/**
 * Map or create. Every distinct role in the job parts is tried against
 * the activated skillboards; the first activated match wins and the
 * rest are recorded as related. With no activated match, a new board
 * is created, named after the primary role, derived from any boards
 * that matched but were not activated.
 */
export async function commissionCourseAssessment(input: CommissionInput): Promise<CommissionResult> {
  const roles = Array.from(new Set(input.job_parts.map((p) => p.role.trim()).filter(Boolean)));
  const labels = roles.length ? roles : [input.course_name];
  const trace: CommissionResult["match_trace"] = [];
  const activated: string[] = [];
  const nearMisses: string[] = [];
  for (const role of labels) {
    const m = await findSkillboardForSpecialisation(role);
    if (m.kind === "miss") {
      trace.push({ role, matched: null, strategy: "none", activated: false });
      continue;
    }
    trace.push({ role, matched: m.storedName, strategy: m.strategy, activated: Boolean(m.activatedAt) && !m.archivedAt });
    if (m.activatedAt && !m.archivedAt) activated.push(m.skillboardId);
    else if (!m.archivedAt) nearMisses.push(m.skillboardId);
  }

  if (activated.length > 0) {
    const [board] = await db.select({ id: skillboards.id, specialisation: skillboards.specialisation }).from(skillboards).where(eq(skillboards.id, activated[0])).limit(1);
    // A mapped board with an empty bank gets its seed jobs queued.
    await ensureBankForSkillboard(board.id).catch(() => undefined);
    return {
      skillboard_id: board.id,
      specialisation: board.specialisation,
      mapped: true,
      related_skillboard_ids: activated.slice(1),
      match_trace: trace,
    };
  }

  // A board this engine already created for this course keeps being reused.
  const specialisation = `${labels[0]} (${input.course_name})`.slice(0, 120);
  const [existing] = await db
    .select({ id: skillboards.id, specialisation: skillboards.specialisation })
    .from(skillboards)
    .where(eq(skillboards.specialisation, specialisation))
    .limit(1);
  if (existing) {
    return { skillboard_id: existing.id, specialisation: existing.specialisation, mapped: false, related_skillboard_ids: nearMisses, match_trace: trace };
  }

  const [board] = await db
    .insert(skillboards)
    .values({
      specialisation,
      description: `Final assessment of the course "${input.course_name}" (Training Engine course ${input.course_ref}).`,
      roleFamily: inferRoleFamily(`${labels.join(" ")} ${input.course_name}`),
      creationPath: "claude_authored",
      provisional: true,
      derivedFrom: nearMisses,
      claudeAuthoringBrief: briefFromCourse(input, specialisation),
    })
    .returning({ id: skillboards.id, specialisation: skillboards.specialisation });

  await db.insert(skillboardAuthoringJobs).values({
    skillboardId: board.id,
    jobType: "structure" as AuthoringJobType,
    result: { reference_urls: [], auto_activate: true, auto_provisioned: true, course_ref: input.course_ref },
  });

  return { skillboard_id: board.id, specialisation: board.specialisation, mapped: false, related_skillboard_ids: nearMisses, match_trace: trace };
}

export type CourseAssessmentStatus = {
  skillboard_id: string;
  specialisation: string;
  activated: boolean;
  archived: boolean;
  questions: number;
  /** authoring: structure not done; bank_empty: no questions yet; ready: can mint sessions */
  state: "authoring" | "bank_empty" | "ready" | "archived";
};

export async function courseAssessmentStatus(skillboardId: string): Promise<CourseAssessmentStatus | null> {
  const [board] = await db
    .select({ id: skillboards.id, specialisation: skillboards.specialisation, activatedAt: skillboards.activatedAt, archivedAt: skillboards.archivedAt })
    .from(skillboards)
    .where(eq(skillboards.id, skillboardId))
    .limit(1);
  if (!board) return null;
  let count = 0;
  if (board.activatedAt) {
    const bank = await getOrCreateValidationBank(board.specialisation);
    const rows = await db.select({ id: questions.id }).from(questions).where(eq(questions.assessmentId, bank.id));
    count = rows.length;
    if (count === 0) await ensureBankForSkillboard(board.id).catch(() => undefined);
  }
  return {
    skillboard_id: board.id,
    specialisation: board.specialisation,
    activated: Boolean(board.activatedAt),
    archived: Boolean(board.archivedAt),
    questions: count,
    state: board.archivedAt ? "archived" : !board.activatedAt ? "authoring" : count === 0 ? "bank_empty" : "ready",
  };
}

export interface MintInput {
  skillboardId: string;
  learnerRef: string;
  email: string;
  name: string;
  band: "junior" | "mid" | "senior";
  redirectUrl?: string;
  expiresInDays: number;
}

export type MintResult =
  | { ok: true; session_id: string; url: string; expires_at: string; reused: boolean }
  | { ok: false; error: "not_ready"; state: CourseAssessmentStatus["state"] | "missing" };

function takeUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://assess.energytalentco.com").replace(/\/$/, "");
  return `${base}/take/${token}`;
}

/**
 * A session for one learner on the course's board. An open, unexpired
 * session for the same learner is returned again rather than
 * duplicated. The metadata marks the origin so the validation
 * post-submit pipeline (synthesis and the onboarding callback) stays
 * out of it: the course's result is the score, read back by Training.
 */
export async function mintCourseSession(input: MintInput): Promise<MintResult> {
  const status = await courseAssessmentStatus(input.skillboardId);
  if (!status) return { ok: false, error: "not_ready", state: "missing" };
  if (status.state !== "ready") return { ok: false, error: "not_ready", state: status.state };
  const bank = await getOrCreateValidationBank(status.specialisation);

  const open = await db
    .select({ id: responses.id, metadata: responses.metadata })
    .from(responses)
    .where(and(eq(responses.assessmentId, bank.id), eq(responses.status, "in_progress")));
  const now = Date.now();
  const mine = open.find((r) => {
    const m = r.metadata as ResponseMetadata & { course_learner_ref?: string; session_expires_at?: string };
    return m.course_learner_ref === input.learnerRef && (!m.session_expires_at || new Date(m.session_expires_at).getTime() > now);
  });
  if (mine) {
    const m = mine.metadata as ResponseMetadata & { session_expires_at?: string };
    return { ok: true, session_id: mine.id, url: takeUrl(mine.id), expires_at: m.session_expires_at ?? "", reused: true };
  }

  const expiresAt = new Date(now + input.expiresInDays * 24 * 3600 * 1000);
  const [row] = await db
    .insert(responses)
    .values({
      assessmentId: bank.id,
      candidateName: input.name,
      candidateEmail: input.email,
      status: "in_progress",
      validationStatus: "pending",
      metadata: {
        path: [],
        specialisation: status.specialisation,
        claimed_band: input.band,
        session_expires_at: expiresAt.toISOString(),
        redirect_url_after_completion: input.redirectUrl,
        validation_origin: "course_assessment",
        course_learner_ref: input.learnerRef,
        walk_order: [],
      } as ResponseMetadata,
    })
    .returning({ id: responses.id });
  await db.update(responses).set({ metadata: { ...(await currentMeta(row.id)), walk_order: [row.id] } as ResponseMetadata }).where(eq(responses.id, row.id));
  return { ok: true, session_id: row.id, url: takeUrl(row.id), expires_at: expiresAt.toISOString(), reused: false };
}

async function currentMeta(id: string): Promise<ResponseMetadata> {
  const [r] = await db.select({ metadata: responses.metadata }).from(responses).where(eq(responses.id, id)).limit(1);
  return (r?.metadata ?? {}) as ResponseMetadata;
}

export type SessionResult = {
  session_id: string;
  status: "in_progress" | "submitted" | "expired";
  percent: number | null;
  pass: boolean | null;
  /** provisional until the AI scoring pipeline has run on every open answer */
  score_state: "provisional" | "final" | null;
  submitted_at: string | null;
  expires_at: string | null;
  url: string;
};

export async function courseSessionResult(sessionId: string, learnerRef: string): Promise<SessionResult | null> {
  const [r] = await db
    .select({
      id: responses.id,
      status: responses.status,
      totalScore: responses.totalScore,
      max: responses.maxPossibleScore,
      pass: responses.pass,
      submittedAt: responses.submittedAt,
      ranAt: responses.aiPipelineRanAt,
      metadata: responses.metadata,
      mode: assessments.mode,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, sessionId))
    .limit(1);
  if (!r) return null;
  const m = r.metadata as ResponseMetadata & { course_learner_ref?: string; session_expires_at?: string };
  if (m.course_learner_ref !== learnerRef) return null;
  const expired = !r.submittedAt && m.session_expires_at ? new Date(m.session_expires_at).getTime() < Date.now() : false;
  const percent = r.submittedAt && r.max > 0 && r.totalScore !== null ? Math.round((r.totalScore / r.max) * 100) : null;
  return {
    session_id: r.id,
    status: r.submittedAt ? "submitted" : expired ? "expired" : "in_progress",
    percent,
    pass: r.pass,
    score_state: r.submittedAt ? (r.ranAt ? "final" : "provisional") : null,
    submitted_at: r.submittedAt?.toISOString() ?? null,
    expires_at: m.session_expires_at ?? null,
    url: takeUrl(r.id),
  };
}

