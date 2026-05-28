/**
 * Outbound completion callback to Onboarding.
 *
 * After synthesis writes the Vetted Talent Profile, this fires:
 *   POST {ONBOARDING_API_URL}/api/internal/validations/completed
 *
 * See: docs/2026-05-28-validation-trigger-contract-v1.0.md (endpoint 3).
 *
 * The body is intentionally tiny — just enough for the popup. The full
 * profile is fetched separately via our GET /vetted-profiles endpoint.
 *
 * Retry policy:
 *   - 6 attempts with backoff 1s, 2s, 4s, 8s, 16s, 32s (~1 min total)
 *   - 4xx is terminal (don't retry — Onboarding rejected the payload)
 *   - 5xx and network errors are retried
 *   - If all 6 attempts fail, we write to notify_log with severity='warn'
 *     so the candidate's profile still shows up via pull (endpoint 2)
 *     and an admin can manually re-trigger if needed.
 */

import { db } from "@/lib/db/client";
import { notifyLog } from "@/lib/db/schema";

const CALLBACK_PATH = "/api/internal/validations/completed";
const MAX_ATTEMPTS = 6;

export type CompletionPayload = {
  candidate_id: string;
  session_id: string;
  completed_at: string;
  per_spec_summary: Array<{
    specialisation: string;
    cadre: string;
    display_label: string;
  }>;
  /** Where the candidate should land for full details (the talent profile page). */
  result_url: string;
};

export type CompletionResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; error: string };

export async function postValidationCompleted(
  payload: CompletionPayload,
): Promise<CompletionResult> {
  const url = resolveCallbackUrl();
  const token = process.env.ETC_ASSESSMENT_SERVICE_TOKEN;

  if (!url || !token) {
    // Best-effort: log to notify_log and return, so the synthesis pipeline
    // doesn't crash. Pull endpoint backstops.
    await safeNotifyLog({
      severity: "warn",
      summary: "Onboarding completion callback skipped",
      detail: `Missing env: ${!url ? "ONBOARDING_API_URL" : "ETC_ASSESSMENT_SERVICE_TOKEN"}`,
      payload,
    });
    return {
      ok: false,
      attempts: 0,
      error: "missing_env",
    };
  }

  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        // 10s per-attempt timeout — Onboarding can return quickly
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        return { ok: true, attempts: attempt };
      }
      if (res.status >= 400 && res.status < 500) {
        // Terminal — Onboarding rejected. Don't retry.
        const body = await res.text().catch(() => "");
        lastError = `4xx ${res.status}: ${body.slice(0, 200)}`;
        await safeNotifyLog({
          severity: "error",
          summary: "Onboarding rejected validation_completed payload",
          detail: lastError,
          payload,
        });
        return { ok: false, attempts: attempt, error: lastError };
      }
      lastError = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "fetch failed";
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt));
    }
  }

  await safeNotifyLog({
    severity: "warn",
    summary: "Onboarding completion callback exhausted retries",
    detail: lastError,
    payload,
  });
  return { ok: false, attempts: MAX_ATTEMPTS, error: lastError };
}

function resolveCallbackUrl(): string | null {
  const base = process.env.ONBOARDING_API_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/$/, "")}${CALLBACK_PATH}`;
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s, 8s, 16s, 32s
  return Math.min(1000 * 2 ** (attempt - 1), 32_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeNotifyLog(args: {
  severity: "info" | "warn" | "error" | "critical";
  summary: string;
  detail: string;
  payload: CompletionPayload;
}): Promise<void> {
  try {
    await db.insert(notifyLog).values({
      severity: args.severity,
      eventType: "onboarding_completion_callback",
      channel: "noop",
      payload: {
        summary: args.summary,
        detail: args.detail,
        completion_payload: args.payload,
      } as unknown,
      deliveryStatus: args.severity === "warn" || args.severity === "error" ? "failed" : "ok",
    });
  } catch {
    // notify_log table missing or DB unreachable. Don't crash the caller.
  }
}
