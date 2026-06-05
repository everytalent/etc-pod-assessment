/**
 * /admin/shadow-review
 *
 * First-90-days human-AI agreement queue. Every validation result
 * with requires_human_review=true (confidence below threshold OR
 * Kimi self-flagged) lands here. Reviewer opens, looks at the
 * synthesised profile, and decides:
 *
 *   - Accept as-is (sets validation_results.final_source = 'human_override'
 *     but doesn't change values — pure approval)
 *   - Override one or more fields (via the existing
 *     /admin/responses/[id]/vetted-profile page)
 *   - Reject (admin marks shouldn't_have_been_synthesised)
 *
 * MVP scope: just the LIST. Per-row actions link to the existing
 * /admin/responses/[id]/vetted-profile drill-in, which already has
 * override UIs. A dedicated per-row 'approve' button can come later.
 */

import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  assessments,
  responses,
  validationResults,
  vettedTalentProfile,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function ShadowReviewPage() {
  const auth = await requireEditorApi();
  if (!auth.user) return null;
  if (
    auth.session.admin.role !== "admin" &&
    auth.session.admin.role !== "superadmin"
  ) {
    notFound();
  }

  // Validation results flagged for review, joined to the vetted
  // profile for at-a-glance triage info.
  const rows = await db
    .select({
      responseId: validationResults.responseId,
      hireRecommendation: validationResults.hireRecommendation,
      confidence: validationResults.confidence,
      synthesisedAt: validationResults.synthesisedAt,
      finalSource: validationResults.finalSource,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      assessmentTitle: assessments.title,
    })
    .from(validationResults)
    .innerJoin(responses, eq(responses.id, validationResults.responseId))
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .where(eq(validationResults.requiresHumanReview, true))
    .orderBy(desc(validationResults.synthesisedAt))
    .limit(100);

  // Pull the per-spec breakdowns in a second query (one round-trip cheaper
  // than left-joining and unflattening).
  const responseIds = rows.map((r) => r.responseId);
  const profilesByResponse = new Map<
    string,
    Array<{ specialisation: string; cadre: string; displayLabel: string }>
  >();
  if (responseIds.length > 0) {
    const profileRows = await db
      .select({
        responseId: vettedTalentProfile.responseId,
        specialisation: vettedTalentProfile.specialisation,
        cadre: vettedTalentProfile.cadre,
        displayLabel: vettedTalentProfile.displayLabel,
      })
      .from(vettedTalentProfile);
    for (const p of profileRows) {
      if (!responseIds.includes(p.responseId)) continue;
      const list = profilesByResponse.get(p.responseId) ?? [];
      list.push({
        specialisation: p.specialisation,
        cadre: p.cadre,
        displayLabel: p.displayLabel,
      });
      profilesByResponse.set(p.responseId, list);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            First-90-days mandate
          </p>
          <h1 className="mt-2 text-3xl font-bold">Shadow Review Queue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Validation results the engine flagged for human review (low
            confidence or self-flagged uncertainty). Open each to review
            the synthesised profile and apply overrides if needed.
          </p>
        </div>
        <a
          href="/api/admin/vetted-profiles/export-csv"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card px-4 text-xs font-medium hover:border-etc-marigold"
          download
        >
          ⤓ Download all profiles CSV
        </a>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
          🎉 Empty queue — no results pending human review right now.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const profiles = profilesByResponse.get(r.responseId) ?? [];
            return (
              <a
                key={r.responseId}
                href={`/admin/responses/${r.responseId}/vetted-profile`}
                className="block rounded-2xl border border-amber-200 bg-amber-50/60 p-4 hover:border-amber-400"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {r.candidateName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {r.candidateEmail}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.assessmentTitle}
                    </p>
                    {profiles.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {profiles.map((p) => (
                          <span
                            key={p.specialisation}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[0.7rem]"
                          >
                            <span className="font-medium">{p.specialisation}</span>
                            <span className="text-muted-foreground">·</span>
                            <span className="uppercase tracking-wider text-muted-foreground">
                              {p.cadre}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[0.7rem]">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-medium ${
                        r.hireRecommendation === "hire"
                          ? "border-green-300 bg-green-50 text-green-900"
                          : r.hireRecommendation === "no_hire"
                            ? "border-red-300 bg-red-50 text-red-900"
                            : "border-blue-300 bg-blue-50 text-blue-900"
                      }`}
                    >
                      {r.hireRecommendation.replace(/_/g, " ")}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      confidence {(r.confidence / 100).toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">
                      {r.synthesisedAt?.toISOString().slice(0, 10)}
                    </span>
                    {r.finalSource === "human_override" && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-900">
                        overridden
                      </span>
                    )}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
