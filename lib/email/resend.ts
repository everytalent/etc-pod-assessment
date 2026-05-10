/**
 * Minimal Resend HTTP client. We don't need the full SDK — one POST.
 *
 * Requires RESEND_API_KEY. The "from" address must be on a domain you've
 * verified in Resend (we use noreply@energytalentco.com).
 *
 * Throws on transport errors so the caller decides whether to swallow or
 * surface them. Email sending is rarely critical-path; in most places we
 * try/catch around this and continue regardless.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "ETC POD Admin <noreply@energytalentco.com>";

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
};

type ResendResponse = { id: string };

export async function sendEmail(args: SendArgs): Promise<ResendResponse> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from ?? DEFAULT_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${text || res.statusText}`);
  }
  return (await res.json()) as ResendResponse;
}
