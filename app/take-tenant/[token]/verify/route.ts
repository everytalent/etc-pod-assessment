/**
 * POST /take-tenant/[token]/verify
 *
 * Two actions, one endpoint:
 *   { action: 'send' }             — mint a fresh 6-digit code, store its
 *                                     hash + expiry on responses.metadata,
 *                                     email it to the candidate.
 *   { action: 'check', code: '..'} — validate the code, mark the response
 *                                     as identity-verified.
 *
 * Auth: candidate session cookie must resolve to a response tied to this
 * bank (via assessment.slug ↔ tenantAssessmentBank.assessmentLinkToken).
 *
 * Codes expire after 15 minutes. Six attempts allowed per code. A new
 * `send` invalidates prior codes.
 */

import { createHash, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/resend";
import {
  assessments,
  responses,
  tenantAssessmentBank,
  type ResponseMetadata,
} from "@/lib/db/schema";
import { getCandidateSession } from "@/lib/session";
import { getTenantBrand } from "@/lib/tenant/branding";

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 6;

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({
    action: z.literal("check"),
    code: z.string().trim().regex(/^\d{6}$/),
  }),
]);

type VerifyMetadata = ResponseMetadata & {
  identity_verify?: {
    code_hash: string;
    expires_at: string;
    attempts: number;
  };
  identity_verified_at?: string;
};

function mint6Digits(): string {
  // Uniform 000000-999999 without modulo bias by rejecting values above
  // the largest multiple of 1_000_000 that fits into a u32.
  const CAP = Math.floor(0xffffffff / 1_000_000) * 1_000_000;
  let n: number;
  do {
    n = randomBytes(4).readUInt32BE(0);
  } while (n >= CAP);
  return String(n % 1_000_000).padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  const responseId = await getCandidateSession();
  if (!responseId) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [row] = await db
    .select({
      responseId: responses.id,
      candidateName: responses.candidateName,
      candidateEmail: responses.candidateEmail,
      metadata: responses.metadata,
      tenantId: tenantAssessmentBank.tenantId,
    })
    .from(responses)
    .innerJoin(assessments, eq(assessments.id, responses.assessmentId))
    .innerJoin(
      tenantAssessmentBank,
      eq(tenantAssessmentBank.assessmentLinkToken, assessments.slug),
    )
    .where(
      and(
        eq(responses.id, responseId),
        eq(tenantAssessmentBank.assessmentLinkToken, token),
      ),
    )
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const meta = (row.metadata ?? {}) as VerifyMetadata;

  if (input.action === "send") {
    const code = mint6Digits();
    const nextMeta: VerifyMetadata = {
      ...meta,
      identity_verify: {
        code_hash: hashCode(code),
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        attempts: 0,
      },
    };
    await db
      .update(responses)
      .set({ metadata: nextMeta })
      .where(eq(responses.id, responseId));

    try {
      const brand = await getTenantBrand(row.tenantId);
      const primary = brand.primaryColor || "#f1b240";
      const firstName = row.candidateName.split(" ")[0] || "there";
      await sendEmail({
        to: row.candidateEmail,
        subject: "Your ETC assessment verification code",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#020301;">
            <p style="font-size:14px;line-height:1.6;margin:0 0 16px 0;">Hi ${firstName},</p>
            <p style="font-size:14px;line-height:1.6;margin:0 0 16px 0;">Enter this code to start your assessment. It expires in 15 minutes.</p>
            <p style="font-size:28px;font-weight:700;letter-spacing:0.3em;background:#f9fafb;padding:16px 24px;border-radius:12px;text-align:center;margin:16px 0;">${code}</p>
            <p style="color:#6b7280;font-size:12px;line-height:1.5;margin:16px 0 0 0;">If you didn't request this, ignore this email.</p>
            <p style="color:${primary};font-size:11px;margin-top:24px;">Powered by ETC</p>
          </div>
        `,
      });
    } catch (err) {
      // Best effort: log and continue. If email fails they can request
      // a resend and we'd rather not fail-closed on a Resend blip.
      console.error("verify code email failed", err);
      return NextResponse.json(
        { error: "email_send_failed" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, sent_to: row.candidateEmail });
  }

  // action === 'check'
  const state = meta.identity_verify;
  if (!state) {
    return NextResponse.json({ error: "no_code_pending" }, { status: 400 });
  }
  if (new Date(state.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "code_expired" }, { status: 400 });
  }
  if (state.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  const submitted = hashCode(input.code);
  const nextAttempts = state.attempts + 1;

  if (submitted !== state.code_hash) {
    await db
      .update(responses)
      .set({
        metadata: {
          ...meta,
          identity_verify: { ...state, attempts: nextAttempts },
        },
      })
      .where(eq(responses.id, responseId));
    return NextResponse.json(
      {
        error: "wrong_code",
        attempts_remaining: Math.max(0, MAX_ATTEMPTS - nextAttempts),
      },
      { status: 400 },
    );
  }

  // Success: clear the pending code, stamp verified_at.
  const cleared: VerifyMetadata = { ...meta };
  delete cleared.identity_verify;
  cleared.identity_verified_at = new Date().toISOString();
  await db
    .update(responses)
    .set({ metadata: cleared })
    .where(eq(responses.id, responseId));

  return NextResponse.json({ ok: true });
}
