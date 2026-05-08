/**
 * New assessment — minimal form, then redirects to /edit so the admin can
 * add questions and rules.
 */

import { NewAssessmentForm } from "@/components/admin/NewAssessmentForm";

export default function NewAssessmentPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        New assessment
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Create</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Set the metadata; you&rsquo;ll add questions and branching on the next page.
      </p>
      <div className="mt-8">
        <NewAssessmentForm />
      </div>
    </main>
  );
}
