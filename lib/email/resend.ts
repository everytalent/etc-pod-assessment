/**
 * Minimal Resend HTTP client. We don't need the full SDK — one POST.
 *
 * Requires RESEND_API_KEY. The "from" address must be on a domain you
 * have verified in Resend. Set EMAIL_FROM to override the default
 * without a deploy: if the sending domain ever changes, or the one in
 * the default is not verified, that is an environment variable rather
 * than a code change.
 *
 * Throws on transport errors so the caller decides whether to swallow or
 * surface them. Email sending is rarely critical-path; in most places we
 * try/catch around this and continue regardless.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Every Talent Co is the current name; the older energytalentco.com
// domain still exists in Resend, so EMAIL_FROM can point back at it if
// this one is ever unverified.
const DEFAULT_FROM =
  process.env.EMAIL_FROM ?? "Every Talent Co <noreply@everytalentco.com>";

type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
};

type ResendResponse = { id: string };

/**
 * Thrown when email cannot be sent because nothing is configured to send
 * it, as opposed to a send that was attempted and failed.
 *
 * Callers need to tell these apart. A transport blip is worth retrying
 * and worth telling the user to retry; an unset key never resolves on
 * its own, and inviting someone to "try again in a moment" for it leaves
 * them tapping a button forever. That is exactly what candidates hit on
 * the tenant assessment verification screen: RESEND_API_KEY was not set
 * on the site at all, so no verification code could ever be sent and the
 * screen kept asking them to try again.
 */
export class EmailNotConfiguredError extends Error {
  readonly code = "email_not_configured";
  constructor() {
    super(
      "RESEND_API_KEY is not set, so no email can be sent. This is a " +
        "configuration gap, not a transient failure: set it in the site's " +
        "environment variables.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(args: SendArgs): Promise<ResendResponse> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Loud on the server, because nothing downstream can recover from it
    // and the symptom (a user stuck on a code screen) looks nothing like
    // the cause.
    console.error(
      "[email] RESEND_API_KEY is not set — dropping message:",
      args.subject,
    );
    throw new EmailNotConfiguredError();
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
