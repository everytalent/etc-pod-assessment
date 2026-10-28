/**
 * Delete one candidate's submission to a tenant assessment.
 *
 * Companies need to clear test runs, duplicates and people who should never
 * have been sent the link. The delete is permanent: answers, scores, overrides
 * and integrity findings all cascade from the response row.
 *
 * Ownership runs response → assessment → bank (the bank's link token is the
 * assessment's slug), and the caller says which tenant or which bank it is
 * acting for. A response that does not sit under that tenant or bank is
 * reported as not found, so one company cannot probe another's ids.
 */

import { and, eq, type SQL } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { assessments, responses, tenantAssessmentBank } from "@/lib/db/schema";

export async function deleteTenantResponse(args: {
  responseId: string;
  tenantId?: string;
  bankId?: string;
}): Promise<"deleted" | "not_found"> {
  const scope: SQL[] = [eq(responses.id, args.responseId)];
  if (args.tenantId) scope.push(eq(tenantAssessmentBank.tenantId, args.tenantId));
  if (args.bankId) scope.push(eq(tenantAssessmentBank.id, args.bankId));
  if (!args.tenantId && !args.bankId) {
    throw new Error("deleteTenantResponse needs a tenantId or a bankId to scope by");
  }

  const [owned] = await db
    .select({ id: responses.id })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .where(and(...scope))
    .limit(1);
  if (!owned) return "not_found";

  await db.delete(responses).where(eq(responses.id, owned.id));
  return "deleted";
}
