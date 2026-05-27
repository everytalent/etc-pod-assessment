/**
 * /admin/skillboards — list page.
 *
 * Server component. Renders one row per skillboard with:
 *   - Specialisation name
 *   - Creation path (Upload / Claude-authored)
 *   - Role family chip
 *   - Activation status ("Pending — 12 of 375 cells" / "Active since …")
 *   - Updated-at
 *
 * Top-right: "New skillboard" button → /admin/skillboards/new.
 */

import Link from "next/link";

import { requireAdminApi } from "@/lib/auth/admin";
import { listSkillboards } from "@/lib/engines/assessment/skillboards/repository";
import type { SkillboardListRow } from "@/lib/engines/assessment/skillboards/types";

export const dynamic = "force-dynamic";

const ROLE_FAMILY_LABEL: Record<SkillboardListRow["role_family"], string> = {
  technical: "Technical",
  bd_pm: "BD / PM",
  hybrid: "Hybrid",
};

const ROLE_FAMILY_CHIP: Record<SkillboardListRow["role_family"], string> = {
  technical: "border-blue-300 bg-blue-50 text-blue-900",
  bd_pm: "border-amber-300 bg-amber-50 text-amber-900",
  hybrid: "border-purple-300 bg-purple-50 text-purple-900",
};

export default async function SkillboardsListPage() {
  const auth = await requireAdminApi();
  if (!auth.user) return null; // middleware redirects unauth'd

  const boards = await listSkillboards();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Skillboards</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Competency frameworks anchored to specialisations. Every
            candidate validation pulls questions from these.
          </p>
        </div>
        <Link
          href="/admin/skillboards/new"
          className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          + New skillboard
        </Link>
      </div>

      {boards.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Specialisation</th>
                <th className="px-4 py-3 text-left font-medium">Role family</th>
                <th className="px-4 py-3 text-left font-medium">Path</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {boards.map((b) => (
                <tr key={b.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/skillboards/${b.id}`}
                      className="font-medium hover:underline"
                    >
                      {b.specialisation}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider ${ROLE_FAMILY_CHIP[b.role_family]}`}
                    >
                      {ROLE_FAMILY_LABEL[b.role_family]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {b.creation_path === "claude_authored"
                      ? "Claude-authored"
                      : "Excel upload"}
                  </td>
                  <td className="px-4 py-3">{renderStatus(b)}</td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                    {new Date(b.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function renderStatus(b: SkillboardListRow) {
  if (b.activated_at) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
        Active
      </span>
    );
  }
  if (b.cells_total === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        Drafting…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {b.cells_pending} of {b.cells_total} pending
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
      <p className="text-sm font-medium">No skillboards yet.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create one to start validating candidates for a specialisation.
      </p>
      <Link
        href="/admin/skillboards/new"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        + New skillboard
      </Link>
    </div>
  );
}
