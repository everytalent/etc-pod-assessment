/**
 * /admin/question-bank-proposals — review queue for Opus-generated
 * question proposals. Approving merges into the sentinel
 * "Validation Bank — <spec>" assessment.
 */

import { ProposalsQueue } from "@/components/admin/ProposalsQueue";
import { requireEditorApi } from "@/lib/auth/admin";

export const dynamic = "force-dynamic";

export default async function ProposalsPage() {
  const auth = await requireEditorApi();
  if (!auth.user) return null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          Question Bank Proposals
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Opus-generated questions waiting for editor approval before they
          enter the live bank.
        </p>
      </header>
      <ProposalsQueue />
    </main>
  );
}
