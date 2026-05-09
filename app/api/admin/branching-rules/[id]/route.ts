/**
 * DELETE /api/admin/branching-rules/[id] — remove a rule.
 *
 * No cycle check needed on delete (a delete only removes edges; deleting
 * an edge from an acyclic graph keeps it acyclic).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { branchingRules } from "@/lib/db/schema";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;
  const removed = await db
    .delete(branchingRules)
    .where(eq(branchingRules.id, id))
    .returning({ id: branchingRules.id });
  if (removed.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ deleted: removed[0]!.id });
}
