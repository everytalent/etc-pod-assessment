/**
 * Public candidate landing — Server Component.
 *
 * Lists every assessment that is `status='published'` AND
 * `visibility='listed'`. Unlisted assessments are link-only and never
 * appear here even when published. If the table is empty (no listed
 * assessments live), we show a soft "nothing here yet" state rather
 * than an error so candidates who land here speculatively aren't
 * confused.
 */

import Link from "next/link";

import { getListedPublishedAssessments } from "@/lib/assessment/queries";

// Render on every request — otherwise Next.js statically generates this
// page at build time and newly published assessments don't appear until
// the next deploy.
export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<"tech" | "bd", string> = {
  tech: "Solar Tech",
  bd: "Business Development",
};

export default async function Home() {
  const cards = await getListedPublishedAssessments();

  return (
    <main className="mx-auto flex min-h-dvh max-w-4xl flex-col px-6 py-16">
      <header className="mb-12">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Energy Talent Co · POD OS
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
          Solar Talent Assessments
        </h1>
        <p className="mt-6 max-w-2xl text-base text-muted-foreground">
          Conversational vetting for candidates joining the ETC POD network.
          Pick the assessment that matches the role you&rsquo;re applying for.
        </p>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            No live assessments
          </p>
          <h2 className="mt-2 text-xl font-semibold">Check back shortly</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            The team is preparing the next batch of assessments. If you have a
            direct invitation link, you can still use it.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/assess/${c.slug}`}
                className="group flex h-full flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:border-etc-marigold focus-visible:border-etc-marigold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-etc-marigold"
              >
                <div>
                  <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {ROLE_LABEL[c.roleType]}
                  </p>
                  <h2 className="mt-2 text-xl font-bold leading-tight">
                    {c.title}
                  </h2>
                  {c.introText && (
                    <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                      {c.introText}
                    </p>
                  )}
                </div>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-foreground transition group-hover:text-etc-marigold">
                  Start assessment
                  <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-16 text-xs text-muted-foreground">
        <p>
          Energy Talent Company &middot; POD project assessment platform
        </p>
      </footer>
    </main>
  );
}
