/**
 * GET / POST /api/v1/admin/algorithm-tuning
 *
 * PRD §1a + Open Questions. Read or update the similarity_threshold
 * that the tenant builder matcher uses. Superadmin OR an admin user
 * with can_approve_skillboards (Learning Expert role) can write.
 *
 * Audit-logged into system_config.updated_by; a 24-hour cooldown is
 * enforced server-side to prevent thrash.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { systemConfig } from "@/lib/db/schema";

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

const putSchema = z.object({
  similarity_threshold: z.number().min(0).max(1),
  reason: z.string().min(10).max(500),
});

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "similarity_threshold"))
    .limit(1);
  return NextResponse.json({
    similarity_threshold: row?.valueNumeric ? Number(row.valueNumeric) : 0.78,
    last_updated_at: row?.updatedAt?.toISOString() ?? null,
    last_updated_by: row?.updatedBy ?? null,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAdminApi();
  if (!auth.user) return auth.unauthorized;

  const role = auth.session.admin.role;
  const isLE = auth.session.admin.canApproveSkillboards;
  if (role !== "superadmin" && !isLE) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "Superadmin or Learning Expert only.",
      },
      { status: 403 },
    );
  }

  let parsed;
  try {
    parsed = putSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "similarity_threshold"))
    .limit(1);
  if (existing?.updatedAt) {
    const age = Date.now() - existing.updatedAt.getTime();
    if (age < COOLDOWN_MS) {
      return NextResponse.json(
        {
          error: "cooldown",
          retry_after_ms: COOLDOWN_MS - age,
        },
        { status: 429 },
      );
    }
  }

  const now = new Date();
  if (existing) {
    await db
      .update(systemConfig)
      .set({
        valueNumeric: String(parsed.similarity_threshold),
        updatedBy: auth.session.admin.id,
        updatedAt: now,
      })
      .where(eq(systemConfig.key, "similarity_threshold"));
  } else {
    await db.insert(systemConfig).values({
      key: "similarity_threshold",
      valueNumeric: String(parsed.similarity_threshold),
      updatedBy: auth.session.admin.id,
    });
  }

  console.log(
    JSON.stringify({
      stream: "etc.audit",
      event: "algorithm_tuning_change",
      key: "similarity_threshold",
      new_value: parsed.similarity_threshold,
      reason: parsed.reason,
      by: auth.session.admin.id,
      at: now.toISOString(),
    }),
  );

  return NextResponse.json({
    ok: true,
    similarity_threshold: parsed.similarity_threshold,
  });
}
