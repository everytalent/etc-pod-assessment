/**
 * Outro — Server Component.
 *
 * Renders the assessment's `outro_text`. If we still have a session cookie
 * pointing to a finalised response for this slug, we clear it. The PRD
 * leaves a `show_score_to_candidate` flag for the future — for Phase 1 we
 * never reveal the score on this page (the threshold message is enough).
 */

import { getAssessmentBySlug } from "@/lib/assessment/queries";

export const dynamic = "force-dynamic";

export default async function AssessDonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const assessment = await getAssessmentBySlug(slug);

  // Cookie cleanup now happens inside POST /api/sessions/finalize
  // (Next.js 16 forbids cookie mutation in Server Components). If a
  // candidate hard-refreshes /assess/[slug] with a stale cookie pointing
  // at a finalised response, the session page already redirects to
  // /done on its own status check — no second cleanup needed here.

  const outroText =
    assessment?.outroText ||
    "Thanks — your responses are submitted. We'll be in touch on WhatsApp within 48 hours.";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-6 py-10">
      <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <span className="text-lg font-bold">✓</span>
        </div>
        <p className="mt-4 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {assessment?.title ?? "Assessment"}
        </p>
        <h1 className="mt-2 text-2xl font-bold">Submitted</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {outroText}
        </p>
      </div>
    </main>
  );
}
