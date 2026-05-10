/**
 * POST /api/admin/assessments/[id]/responses/archive-summary-email
 *
 * Sends a summary email to the requesting admin once the audio archive
 * loop in ZohoExportButton finishes. The client tracks running totals
 * across batches; this endpoint just turns those into a branded email.
 *
 * Body:
 *   {
 *     archived: number,
 *     failed: number,
 *     remaining: number,
 *     workdrive_url: string,
 *     file_name: string,
 *     response_count: number,
 *     voice_answer_count: number,
 *     errors?: { answer_id: string; message: string }[]
 *   }
 *
 * Returns { sent: true } on success or { sent: false, error } on Resend
 * failure — never blocks the UI; the archive itself is already done.
 *
 * Permission: editor or above (CAN.archiveAudio).
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireEditorApi } from "@/lib/auth/admin";
import { db } from "@/lib/db/client";
import { assessments } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/resend";

const inputSchema = z.object({
  archived: z.number().int().min(0),
  failed: z.number().int().min(0),
  remaining: z.number().int().min(0),
  workdrive_url: z.string().url(),
  file_name: z.string().min(1),
  response_count: z.number().int().min(0),
  voice_answer_count: z.number().int().min(0),
  errors: z
    .array(z.object({ answer_id: z.string(), message: z.string() }))
    .max(50)
    .optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireEditorApi();
  if (!auth.user) return auth.unauthorized;
  const { id } = await params;

  let input;
  try {
    input = inputSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const [assessment] = await db
    .select({ title: assessments.title, slug: assessments.slug })
    .from(assessments)
    .where(eq(assessments.id, id))
    .limit(1);
  if (!assessment) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const html = renderSummaryHtml({
    assessmentTitle: assessment.title,
    archived: input.archived,
    failed: input.failed,
    remaining: input.remaining,
    workdriveUrl: input.workdrive_url,
    fileName: input.file_name,
    responseCount: input.response_count,
    voiceAnswerCount: input.voice_answer_count,
    errors: input.errors ?? [],
  });
  const subject = `Zoho export complete · ${assessment.title}`;

  try {
    await sendEmail({ to: auth.user.email, subject, html });
    return NextResponse.json({ sent: true });
  } catch (err) {
    return NextResponse.json({
      sent: false,
      error: err instanceof Error ? err.message : "send_failed",
    });
  }
}

type SummaryHtmlArgs = {
  assessmentTitle: string;
  archived: number;
  failed: number;
  remaining: number;
  workdriveUrl: string;
  fileName: string;
  responseCount: number;
  voiceAnswerCount: number;
  errors: { answer_id: string; message: string }[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSummaryHtml(args: SummaryHtmlArgs): string {
  const errorList = args.errors.length
    ? `
      <p style="font-size:13px;color:#6b7280;margin:16px 0 8px 0;">First ${Math.min(args.errors.length, 10)} errors:</p>
      <ul style="font-size:12px;color:#020301;font-family:ui-monospace,Menlo,monospace;padding-left:20px;margin:0 0 16px 0;">
        ${args.errors
          .slice(0, 10)
          .map(
            (e) =>
              `<li>${escapeHtml(e.answer_id.slice(0, 8))}: ${escapeHtml(e.message)}</li>`,
          )
          .join("")}
      </ul>`
    : "";

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#020301;">
  <p style="font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#6b7280;margin:0 0 8px 0;">ETC POD Admin · Zoho export</p>
  <h2 style="font-size:22px;font-weight:700;margin:0 0 16px 0;">Archive complete</h2>

  <p style="font-size:14px;line-height:1.6;margin:0 0 8px 0;">Assessment: <strong>${escapeHtml(args.assessmentTitle)}</strong></p>
  <p style="font-size:14px;line-height:1.6;margin:0 0 24px 0;">Sheet: <strong>${escapeHtml(args.fileName)}</strong> &middot; ${args.responseCount} response${args.responseCount === 1 ? "" : "s"} &middot; ${args.voiceAnswerCount} voice answer${args.voiceAnswerCount === 1 ? "" : "s"}</p>

  <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:0 0 24px 0;background:#fafafa;">
    <p style="font-size:13px;margin:0 0 8px 0;"><strong style="font-size:18px;color:#020301;">${args.archived}</strong> audio file${args.archived === 1 ? "" : "s"} archived to Zoho Drive</p>
    ${args.failed > 0 ? `<p style="font-size:13px;margin:0 0 4px 0;color:#dc2626;"><strong>${args.failed}</strong> failed</p>` : ""}
    ${args.remaining > 0 ? `<p style="font-size:13px;margin:0;color:#6b7280;"><strong>${args.remaining}</strong> remaining (likely failed) — re-run to retry</p>` : ""}
    ${args.failed === 0 && args.remaining === 0 ? `<p style="font-size:13px;margin:0;color:#6b7280;">No failures. All voice answers now in cold storage.</p>` : ""}
  </div>

  ${errorList}

  <p style="margin:0 0 24px 0;">
    <a href="${escapeHtml(args.workdriveUrl)}"
       style="display:inline-block;background:#f1b240;color:#020301;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:600;font-size:14px;">
      Open the Sheet in Zoho WorkDrive
    </a>
  </p>

  <p style="color:#9ca3af;font-size:12px;margin:0;">Energy Talent Company &middot; etc-pod-assessment</p>
</div>`;
}
