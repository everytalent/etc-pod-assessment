/**
 * The waitlist that makes "we'll email you the moment it's ready" true.
 *
 * A candidate whose specialisation had no usable validation bank was
 * shown that sentence and then forgotten about: nothing recorded that
 * they had been turned away, so no email could ever be sent, and the
 * only way they ever got assessed was by coming back and trying again
 * on the off-chance. This records them on the way out and emails them
 * on the way back in.
 *
 * Two halves:
 *   - addToWaitlist, called from /api/internal/sessions when a
 *     specialisation cannot be served.
 *   - notifyReadyWaitlists, swept by the background worker after it
 *     drains the authoring queue, which is exactly when a bank has just
 *     gained questions.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { questions, validationWaitlist } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/resend";
import { getOrCreateValidationBank } from "@/lib/engines/assessment/proposals/validation-bank";
import { findSkillboardForSpecialisation } from "@/lib/engines/assessment/specialisation-matcher";

/**
 * How many questions a bank needs before we call it open.
 *
 * One question is technically enough for the session route to let
 * someone in, but an adaptive assessment with a handful of questions
 * gives a poor reading, and telling a candidate to come back for that
 * wastes the one moment we have their attention. This waits for enough
 * to be worth their time.
 */
const READY_QUESTION_THRESHOLD = Number(
  process.env.WAITLIST_READY_QUESTION_THRESHOLD ?? "30",
);

/** Cap per sweep, so one tick cannot fan out into hundreds of emails. */
const MAX_EMAILS_PER_SWEEP = 50;

export async function addToWaitlist(args: {
  candidateId: string;
  candidateEmail: string;
  candidateName?: string | null;
  specialisation: string;
  reason: "unknown" | "empty_bank";
}): Promise<void> {
  if (!args.candidateEmail) return;

  // The partial unique index covers (candidate_id, specialisation) while
  // notified_at IS NULL, so a candidate who retries daily keeps one open
  // row rather than accumulating one per attempt.
  await db
    .insert(validationWaitlist)
    .values({
      candidateId: args.candidateId,
      candidateEmail: args.candidateEmail,
      candidateName: args.candidateName ?? null,
      specialisation: args.specialisation,
      reason: args.reason,
    })
    .onConflictDoNothing();
}

export interface WaitlistSweepResult {
  specialisationsChecked: number;
  emailsSent: number;
  failures: number;
}

/**
 * Email everyone whose specialisation has become assessable.
 *
 * Safe to call on every worker tick: it only looks at rows still owed an
 * email, and stamps each row before moving on, so a crash mid-sweep
 * cannot re-send to the people already told.
 */
export async function notifyReadyWaitlists(): Promise<WaitlistSweepResult> {
  const pending = await db
    .select({
      specialisation: validationWaitlist.specialisation,
      waiting: sql<number>`count(*)::int`,
    })
    .from(validationWaitlist)
    .where(isNull(validationWaitlist.notifiedAt))
    .groupBy(validationWaitlist.specialisation);

  const result: WaitlistSweepResult = {
    specialisationsChecked: pending.length,
    emailsSent: 0,
    failures: 0,
  };
  if (pending.length === 0) return result;

  for (const group of pending) {
    if (result.emailsSent >= MAX_EMAILS_PER_SWEEP) break;

    const match = await findSkillboardForSpecialisation(group.specialisation);
    if (match.kind !== "match" || !match.activatedAt || match.archivedAt) {
      continue;
    }

    const bank = await getOrCreateValidationBank(match.storedName);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(eq(questions.assessmentId, bank.id));
    if (n < READY_QUESTION_THRESHOLD) continue;

    const rows = await db
      .select({
        id: validationWaitlist.id,
        candidateEmail: validationWaitlist.candidateEmail,
        candidateName: validationWaitlist.candidateName,
      })
      .from(validationWaitlist)
      .where(
        and(
          eq(validationWaitlist.specialisation, group.specialisation),
          isNull(validationWaitlist.notifiedAt),
        ),
      )
      .limit(MAX_EMAILS_PER_SWEEP - result.emailsSent);

    for (const row of rows) {
      const firstName = (row.candidateName ?? "").trim().split(/\s+/)[0];
      const greeting = firstName ? `Hi ${firstName},` : "Hi,";
      try {
        await sendEmail({
          to: row.candidateEmail,
          subject: `Your ${group.specialisation} validation is ready`,
          html: [
            `<p>${greeting}</p>`,
            `<p>You asked to be validated for <strong>${group.specialisation}</strong> before we had the assessment built for it. It is ready now.</p>`,
            `<p>Sign in to your profile and start the skills walkthrough. It takes about fifteen to twenty-five minutes, adapts to your answers, and you can pause and come back to it.</p>`,
            `<p>Once you finish, your result goes onto your talent profile and you start being matched to briefs that fit it.</p>`,
            `<p>Every Talent Co</p>`,
          ].join("\n"),
        });
        // Stamped per row rather than per batch: if this loop dies
        // halfway, the people already emailed are not emailed again.
        await db
          .update(validationWaitlist)
          .set({ notifiedAt: new Date() })
          .where(eq(validationWaitlist.id, row.id));
        result.emailsSent += 1;
      } catch (err) {
        result.failures += 1;
        console.warn(
          `[waitlist] email failed for ${row.candidateEmail}: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
      }
    }
  }

  return result;
}
