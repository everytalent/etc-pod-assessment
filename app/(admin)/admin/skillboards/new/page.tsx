/**
 * /admin/skillboards/new — page wrapper.
 *
 * Server component just to do the auth gate; the form itself is a
 * client component because it needs live role-family suggestion +
 * brief-vet feedback.
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getAdminSession } from "@/lib/auth/admin";
import {
  canAccessSkillboards,
  loadSkillboardAccessRoles,
} from "@/lib/auth/feature-flags";
import { NewSkillboardForm } from "@/components/admin/NewSkillboardForm";

export const dynamic = "force-dynamic";

export default async function NewSkillboardPage() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  // Skillboard access via the new role-based feature flag (superadmin bypass).
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
          New skillboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          chioma.ai will author skills, tasks, and 15 expectation cells per
          task. Per-task cells run as a background queue you can monitor.
        </p>
      </div>
      <NewSkillboardForm />
    </main>
  );
}
