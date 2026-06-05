/**
 * /admin/skillboards/upload — Excel upload path for skillboards.
 *
 * The hand-written counterpart to the chioma.ai-authored flow at
 * /admin/skillboards/new. Upload an .xlsx that follows the template
 * (Metadata + Skills + Tasks + Cells sheets); parser validates and
 * inserts every cell pre-filled. No Opus calls.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { UploadSkillboardForm } from "@/components/admin/UploadSkillboardForm";
import { getAdminSession } from "@/lib/auth/admin";
import {
  canAccessSkillboards,
  loadSkillboardAccessRoles,
} from "@/lib/auth/feature-flags";

export const dynamic = "force-dynamic";

export default async function UploadSkillboardPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  if (session.admin.role !== "superadmin") {
    const allowed = await loadSkillboardAccessRoles();
    if (!canAccessSkillboards(session.admin.role, allowed)) {
      notFound();
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <Link
          href="/admin/skillboards"
          className="text-xs text-muted-foreground hover:underline"
        >
          ← back to skillboards
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Upload skillboard (Excel)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-written skills, tasks and cell expectations in an .xlsx
          file. No Opus calls — all text comes directly from the
          spreadsheet. Cells land as 'pending' for Learning Expert
          review.{" "}
          <Link
            href="/admin/skillboards/new"
            className="font-medium underline hover:text-foreground"
          >
            Prefer chioma.ai to draft from a brief?
          </Link>
        </p>
      </div>

      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-900">
        <p className="font-semibold">Template expected sheets:</p>
        <ul className="mt-2 space-y-1 list-disc pl-5">
          <li>
            <b>Metadata</b>: rows <code>specialisation</code>,{" "}
            <code>description</code>, <code>role_family</code> (technical /
            bd_pm / hybrid)
          </li>
          <li>
            <b>Skills</b>: columns <code>order</code>, <code>skill</code>
          </li>
          <li>
            <b>Tasks</b>: columns <code>skill_order</code>,{" "}
            <code>task_order</code>, <code>task</code>
          </li>
          <li>
            <b>Cells</b>: columns <code>skill_order</code>,{" "}
            <code>task_order</code>, <code>band</code>,{" "}
            <code>level</code>, <code>expectation_text</code> — every task
            must have all 15 cells (3 bands × 5 levels)
          </li>
        </ul>
      </section>

      <UploadSkillboardForm />
    </main>
  );
}
