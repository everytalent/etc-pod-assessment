/**
 * /take/[token] — candidate landing page for validation-mode sessions.
 *
 * Token format: a `responses.id` UUID, minted by POST /api/internal/sessions.
 *
 * Flow:
 *   1. Resolve the token → response row + assessment + skillboard spec
 *   2. Check expiry, status (in_progress = good; finalised = show "already done")
 *   3. Render a brief intro card with the spec name, expected duration,
 *      and a "Start validation" button
 *   4. Button posts to /take/[token]/start which sets the candidate cookie
 *      and redirects to /assess/<slug>/session (the existing question runner)
 *
 * The session runner already branches on assessment.mode === 'validation'
 * for the CAT engine (Phase 2 wiring).
 */

import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  type ResponseMetadata,
} from "@/lib/db/schema";

import { StartValidationButton } from "./StartValidationButton";

export const dynamic = "force-dynamic";

type SessionMeta = ResponseMetadata & {
  external_candidate_id?: string;
  specialisation?: string;
  session_expires_at?: string;
  redirect_url_after_completion?: string;
};

export default async function TakeValidationPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  // The token IS the response.id (UUID).
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    notFound();
  }

  const [row] = await db
    .select({
      id: responses.id,
      candidateName: responses.candidateName,
      status: responses.status,
      validationStatus: responses.validationStatus,
      submittedAt: responses.submittedAt,
      metadata: responses.metadata,
      assessmentTitle: assessments.title,
      assessmentSlug: assessments.slug,
      assessmentMode: assessments.mode,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(responses.id, token))
    .limit(1);

  if (!row) {
    notFound();
  }

  const meta = (row.metadata ?? {}) as SessionMeta;

  // Refuse to render if the session is finalised already (candidate is done).
  if (row.submittedAt) {
    return (
      <FinishedScreen
        spec={meta.specialisation ?? row.assessmentTitle}
        redirect={meta.redirect_url_after_completion}
      />
    );
  }

  // Refuse if expired
  if (
    meta.session_expires_at &&
    new Date(meta.session_expires_at).getTime() < Date.now()
  ) {
    return <ExpiredScreen />;
  }

  // Refuse if this isn't a validation-mode session (defensive — POST
  // sessions only creates validation rows, but a paranoid check stops
  // accidental misuse).
  if (row.assessmentMode !== "validation") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
        ETC Talent Validation
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Hi {row.candidateName.split(" ")[0]} — ready to validate?
      </h1>

      <p className="mt-4 text-sm text-muted-foreground">
        You're about to take a short adaptive assessment for{" "}
        <span className="font-semibold text-foreground">
          {meta.specialisation ?? row.assessmentTitle}
        </span>
        . Questions adapt to your answers; expect roughly 15-25 minutes.
      </p>

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          A few things to know
        </p>
        <ul className="mt-3 space-y-2 text-sm text-foreground">
          <li>
            <span aria-hidden>•</span> Answer as honestly as you can — the
            engine adapts to your level.
          </li>
          <li>
            <span aria-hidden>•</span> Some questions have timers. If you
            run out, the engine moves on.
          </li>
          <li>
            <span aria-hidden>•</span> If your network drops, you can come
            back to this same page and resume where you left off.
          </li>
          <li>
            <span aria-hidden>•</span> The result lands on your talent
            profile page when you're done.
          </li>
        </ul>
      </div>

      <div className="mt-8 flex justify-end">
        <StartValidationButton
          token={token}
          assessmentSlug={row.assessmentSlug}
        />
      </div>
    </main>
  );
}

function FinishedScreen({
  spec,
  redirect,
}: {
  spec: string;
  redirect?: string;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">You've already completed this</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your {spec} validation is on file. Your talent profile will show the
        full breakdown.
      </p>
      {redirect && (
        <a
          href={redirect}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Back to your profile
        </a>
      )}
    </main>
  );
}

function ExpiredScreen() {
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <h1 className="text-2xl font-bold">This link has expired</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your validation invite is past its expiry date. Request a fresh
        invite from the platform — your previous answers are not lost,
        you'll just need a new link.
      </p>
    </main>
  );
}
