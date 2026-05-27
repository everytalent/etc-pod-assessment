/**
 * notify() — single entry point for cross-engine health/system events.
 *
 * Severities: info | warn | error | critical
 *
 * Today's implementation routes everything to Resend email; tomorrow,
 * flipping NOTIFY_CHANNEL=cliq routes to a Cliq webhook without any
 * caller-side change. Every dispatch writes an audit row to
 * `notify_log` so we can replay if the channel is down.
 *
 * The interface is intentionally permissive (payload: unknown) so any
 * call site can throw a shape that's most useful for the event,
 * without dragging schema churn through this module on every new event.
 * Discipline is on the *consumer* side: dashboards filter by
 * `event_type` and render the payload they know about.
 *
 * What goes through notify():
 *   - Opus budget warn (80%) and critical (100%)
 *   - Translation pipeline failures (batched daily)
 *   - Kimi synthesis failures after retry
 *   - AI model deprecation / 404 patterns
 *   - Skillboard ingestion failures
 *   - Migration failures in prod
 *
 * What does NOT go through notify():
 *   - Transactional candidate / admin emails (magic link, score notif)
 *     — those stay on `lib/email/resend.ts` direct, with their own
 *     templates and call sites.
 */

import { db } from "@/lib/db/client";
import {
  notifyLog,
  type NotifyChannel,
  type NotifySeverity,
} from "@/lib/db/schema";

import { sendNotifyEmail } from "./channels/email";

export type NotifyEventType =
  // Validation Engine events
  | "opus_budget_warn"
  | "opus_budget_critical"
  | "opus_call_failed"
  | "translation_batch_failures"
  | "kimi_synthesis_failed"
  | "ai_model_deprecation"
  | "skillboard_ingestion_failed"
  | "skillboard_cell_regen_failed"
  | "validation_enum_out_of_range"
  | "spend_ledger_anomaly"
  // Cross-engine events
  | "migration_failure"
  | "cliq_webhook_unreachable"
  | (string & {}); // allow ad-hoc events without changing this union

export type NotifyArgs = {
  severity: NotifySeverity;
  eventType: NotifyEventType;
  payload?: Record<string, unknown>;
  /**
   * Optional override of the channel. Defaults to `process.env.NOTIFY_CHANNEL`
   * → `noop` when unset (so tests never accidentally email anyone).
   */
  channel?: NotifyChannel;
};

const SUPERADMIN_RECIPIENT =
  process.env.NOTIFY_SUPERADMIN_EMAIL ?? "ugo@energytalentco.com";

const APP_HEALTH_RECIPIENT =
  process.env.NOTIFY_APP_HEALTH_EMAIL ?? "app-health@energytalentco.com";

function pickChannel(): NotifyChannel {
  const raw = (process.env.NOTIFY_CHANNEL ?? "noop").toLowerCase();
  if (raw === "email" || raw === "cliq" || raw === "noop") {
    return raw;
  }
  return "noop";
}

export async function notify(args: NotifyArgs): Promise<void> {
  const channel = args.channel ?? pickChannel();
  const payload = args.payload ?? {};

  let deliveryStatus = "ok";

  try {
    if (channel === "email") {
      const recipients =
        args.severity === "critical"
          ? [APP_HEALTH_RECIPIENT, SUPERADMIN_RECIPIENT]
          : [APP_HEALTH_RECIPIENT];
      await sendNotifyEmail({
        to: recipients,
        severity: args.severity,
        eventType: args.eventType,
        payload,
      });
    } else if (channel === "cliq") {
      // Cliq webhook adapter is a stub — flip NOTIFY_CHANNEL=cliq when
      // the webhook URL is ready and replace this block with a fetch.
      // Until then, we log the intent so we can audit what WOULD have
      // been sent.
      console.warn(
        `[notify cliq stub] ${args.severity} ${args.eventType}`,
        payload,
      );
      deliveryStatus = "cliq_stub";
    } else {
      // noop channel — typically test environments or local dev.
      deliveryStatus = "noop";
    }
  } catch (err) {
    deliveryStatus = `error:${err instanceof Error ? err.message : "unknown"}`;
    // Never let a notification failure block the caller. The audit row
    // below captures the failure for later inspection.
  }

  // Audit log — always written, regardless of channel outcome.
  try {
    await db.insert(notifyLog).values({
      severity: args.severity,
      eventType: args.eventType,
      payload,
      channel,
      deliveryStatus,
    });
  } catch (logErr) {
    // Last-resort: console only. If we can't even write the audit row,
    // logging to stderr is the best we can do without recursive
    // notify() calls.
    console.error("[notify] failed to write audit row", logErr);
  }
}
