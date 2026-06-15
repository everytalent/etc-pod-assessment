/**
 * Tenant OTP-code verifier. Client posts { email, token } from the
 * code-entry step of TenantLoginForm; we exchange it for a session and
 * enforce the tenant_users allowlist before returning success.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { tenantUsers } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  token: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { email, token, next } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const [row] = await db
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(eq(tenantUsers.email, email))
    .limit(1);

  if (!row) {
    await supabase.auth.signOut();
    return NextResponse.json(
      { ok: false, error: "not_authorized" },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, next: next || "/tenant" });
}
