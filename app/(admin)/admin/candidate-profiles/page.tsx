/**
 * /admin/candidate-profiles — list of dev/test candidate profiles.
 *
 * Backed by the candidate_profiles SHIM table — these rows stand in
 * for what the Onboarding Engine will provide in production.
 */

import { desc } from "drizzle-orm";

import { CandidateProfileForm } from "@/components/admin/CandidateProfileForm";
import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { candidateProfiles } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function CandidateProfilesPage() {
  const auth = await requireAdminApi();
  if (!auth.user) return null;

  const rows = await db
    .select()
    .from(candidateProfiles)
    .orderBy(desc(candidateProfiles.updatedAt));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Candidate Profiles (dev shim)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Author candidate profiles manually to test the Validation Engine
          end-to-end. In production these come from the Onboarding Engine.
        </p>
      </header>

      <section className="mb-10 rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          New / upsert profile
        </h2>
        <CandidateProfileForm />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Existing profiles ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-xs text-muted-foreground">
            No profiles yet. Create one above to start testing validation runs.
          </p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Candidate ID</th>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Specialisation</th>
                  <th className="px-4 py-3 text-left font-medium">Years</th>
                  <th className="px-4 py-3 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const p = r.profileJson as {
                    full_name?: string;
                    specialisation?: string;
                    years_bucket?: string;
                  };
                  return (
                    <tr key={r.candidateId} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.candidateId}
                      </td>
                      <td className="px-4 py-3">{p.full_name ?? "—"}</td>
                      <td className="px-4 py-3">{p.specialisation ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.years_bucket ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {r.updatedAt.toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
