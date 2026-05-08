/**
 * Assessment builder — Server Component bootstrap, client builder for the
 * interactive bits (drag-to-reorder, modal editor, branching rules).
 */

import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { AssessmentBuilder } from "@/components/admin/AssessmentBuilder";
import { db } from "@/lib/db/client";
import { assessments, branchingRules, questions } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AssessmentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [assessment] = await db
    .select()
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) notFound();

  const [qs, rs] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(eq(questions.assessmentId, id))
      .orderBy(asc(questions.orderIndex)),
    db
      .select()
      .from(branchingRules)
      .where(eq(branchingRules.assessmentId, id)),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <AssessmentBuilder
        initial={{ assessment, questions: qs, rules: rs }}
      />
    </main>
  );
}
