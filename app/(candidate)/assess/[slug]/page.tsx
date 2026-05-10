/**
 * Candidate intake — Server Component.
 *
 * Loads the assessment by slug, gates on `published` status, and (if the
 * candidate already has a live session for this assessment) bounces them
 * straight to /session. Otherwise renders the client IntakeForm.
 */

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { IntakeForm } from "@/components/candidate/IntakeForm";
import { getAdminUser } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { responses } from "@/lib/db/schema";
import {
  getAssessmentBySlug,
  getAssessmentTimeRange,
} from "@/lib/assessment/queries";
import { getCandidateSession } from "@/lib/session";

export default async function AssessIntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const { preview } = await searchParams;
  const assessment = await getAssessmentBySlug(slug);

  // Admin preview: a logged-in admin viewing ?preview=true can see drafts.
  // Non-admin preview attempts are ignored (silently fall through to the
  // standard "not available" path for unpublished assessments).
  const isPreview = preview === "true";
  const adminUser = isPreview ? await getAdminUser() : null;
  const isAdminPreview = isPreview && Boolean(adminUser);

  if (!assessment || (assessment.status !== "published" && !isAdminPreview)) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Assessment
          </p>
          <h1 className="mt-2 text-2xl font-bold">Not available</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <span className="font-mono">/{slug}</span> isn&rsquo;t a published
            assessment. Double-check your invitation link.
          </p>
        </div>
      </main>
    );
  }

  // If a cookie-bound session already exists *for this same assessment*,
  // skip intake — the candidate is mid-flight and just refreshed the URL.
  const existing = await getCandidateSession();
  if (existing) {
    const [row] = await db
      .select({
        status: responses.status,
        assessmentId: responses.assessmentId,
      })
      .from(responses)
      .where(eq(responses.id, existing))
      .limit(1);
    if (
      row &&
      row.assessmentId === assessment.id &&
      row.status === "in_progress"
    ) {
      redirect(`/assess/${slug}/session`);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      {isAdminPreview && (
        <div className="mb-3 w-full rounded-lg border border-etc-marigold bg-etc-marigold/15 px-3 py-2 text-[0.7rem] text-etc-black">
          Admin preview ·{" "}
          <span className="font-mono uppercase">{assessment.status}</span>{" "}
          assessment
        </div>
      )}
      <IntakeForm
        slug={slug}
        title={assessment.title}
        introText={assessment.introText}
        timeRange={await getAssessmentTimeRange(assessment.id)}
      />
    </main>
  );
}
