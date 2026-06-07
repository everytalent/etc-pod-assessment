/**
 * Generation waiting page (Phase 2a placeholder).
 *
 * Phase 3 swaps this out for the full Proverb Engine. For now it polls
 * the bank status every 4 seconds and forwards to the result page when
 * status flips to 'ready'.
 */

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getTenantSession } from "@/lib/auth/tenant";
import { db } from "@/lib/db/client";
import { tenantAssessmentBank } from "@/lib/db/schema";

import { WaitingClient } from "./WaitingClient";

export const dynamic = "force-dynamic";

export default async function WaitingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getTenantSession();
  if (!session) redirect("/tenant/login");
  const { id } = await params;

  const [row] = await db
    .select({
      id: tenantAssessmentBank.id,
      status: tenantAssessmentBank.status,
    })
    .from(tenantAssessmentBank)
    .where(
      and(
        eq(tenantAssessmentBank.id, id),
        eq(tenantAssessmentBank.tenantId, session.tenant.id),
      ),
    )
    .limit(1);

  if (!row) redirect("/tenant");
  if (row.status === "ready") redirect(`/tenant/assessments/${id}`);

  return <WaitingClient id={id} initialStatus={row.status} />;
}
