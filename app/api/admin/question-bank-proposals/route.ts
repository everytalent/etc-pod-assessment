/**
 * GET /api/admin/question-bank-proposals
 *
 * Lists proposals with optional filters.
 *   ?status=pending|approved|rejected (default: pending)
 *   ?specialisation=Solar%20Sales%20Specialist
 *   ?band=junior|mid|senior
 *   ?level=below|nh|g|p|tp
 *   ?limit=50 (max 200)
 *
 * Permission: editor+.
 */

import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import {
  questionBankProposals,
  type PerformanceLevel,
  type ProposalStatus,
  type SeniorityBand,
} from "@/lib/db/schema";

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;

  const { searchParams } = new URL(req.url);
  const status = (searchParams.get("status") ?? "pending") as ProposalStatus;
  const specialisation = searchParams.get("specialisation");
  const band = searchParams.get("band") as SeniorityBand | null;
  const level = searchParams.get("level") as PerformanceLevel | null;
  const limit = Math.min(
    Math.max(Number(searchParams.get("limit") ?? "50"), 1),
    200,
  );

  const conditions = [eq(questionBankProposals.status, status)];
  if (specialisation) conditions.push(eq(questionBankProposals.specialisation, specialisation));
  if (band) conditions.push(eq(questionBankProposals.band, band));
  if (level) conditions.push(eq(questionBankProposals.level, level));

  const rows = await db
    .select()
    .from(questionBankProposals)
    .where(and(...conditions))
    .orderBy(desc(questionBankProposals.proposedAt))
    .limit(limit);

  return NextResponse.json({ proposals: rows });
}
