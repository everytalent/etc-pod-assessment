/**
 * Email channel for the notify() abstraction.
 *
 * Renders a minimal HTML body around the JSON payload so the recipient
 * can read it on mobile without copying into a viewer. Subject line
 * includes severity + event type so inbox filters can route.
 */

import { sendEmail } from "@/lib/email/resend";
import type { NotifySeverity } from "@/lib/db/schema";

type Args = {
  to: string[];
  severity: NotifySeverity;
  eventType: string;
  payload: Record<string, unknown>;
};

const SEVERITY_PREFIX: Record<NotifySeverity, string> = {
  info: "[info]",
  warn: "[WARN]",
  error: "[ERROR]",
  critical: "[CRITICAL]",
};

export async function sendNotifyEmail(args: Args): Promise<void> {
  const subject = `${SEVERITY_PREFIX[args.severity]} ${args.eventType}`;
  const html = renderHtml(args);
  await sendEmail({
    to: args.to,
    subject,
    html,
    from: "ETC Platform Health <noreply@energytalentco.com>",
  });
}

function renderHtml(args: Args): string {
  const safePayload = JSON.stringify(args.payload, null, 2);
  const escapedPayload = escapeHtml(safePayload);
  const color = COLOR_FOR_SEVERITY[args.severity];
  return `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; padding: 24px; max-width: 640px; margin: 0 auto;">
    <div style="border-left: 4px solid ${color}; padding-left: 16px; margin-bottom: 16px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280;">${escapeHtml(args.severity)}</div>
      <div style="font-size: 20px; font-weight: 600;">${escapeHtml(args.eventType)}</div>
    </div>
    <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 12px; color: #1f2937;">${escapedPayload}</pre>
    <p style="font-size: 12px; color: #6b7280; margin-top: 16px;">Sent by ETC Platform Health · ${new Date().toISOString()}</p>
  </body></html>`;
}

const COLOR_FOR_SEVERITY: Record<NotifySeverity, string> = {
  info: "#6366f1",
  warn: "#f59e0b",
  error: "#ef4444",
  critical: "#b91c1c",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
