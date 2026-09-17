/**
 * GET /api/internal/ai-probe — is the Anthropic key on THIS deploy usable?
 *
 * Exists because "out of credit" and "wrong key" are indistinguishable from
 * the outside, and both surface to a tenant as "generation failed". Rotating a
 * key and topping up an account are also two different actions on two
 * different accounts, so after doing either it should be possible to ask this
 * deploy, directly, whether it can actually call the model right now.
 *
 * Makes the smallest real request the API accepts (one token) rather than
 * inspecting configuration, because only a real call distinguishes a valid key
 * on an empty account (400, credit) from a stale key (401, authentication)
 * from a key that works.
 *
 * Never returns the key, or any part of it. The fingerprint is a hash prefix,
 * enough to tell whether the value changed between two checks and useless to
 * anyone who obtains it.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { extractBearer, isValidServiceToken } from "@/lib/auth/service-token";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  if (!isValidServiceToken(extractBearer(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      verdict: "no_key",
      detail: "ANTHROPIC_API_KEY is not set on this deploy.",
    });
  }

  const fingerprint = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      verdict: "unreachable",
      key_fingerprint: fingerprint,
      detail: String(err).slice(0, 200),
    });
  }

  if (res.ok) {
    return NextResponse.json({
      ok: true,
      verdict: "working",
      key_fingerprint: fingerprint,
      detail: "The key authenticated and the account has credit.",
    });
  }

  const text = await res.text().catch(() => "");
  const verdict = /credit balance is too low/i.test(text)
    ? "valid_key_no_credit"
    : res.status === 401
      ? "bad_key"
      : "other_error";

  return NextResponse.json({
    ok: false,
    verdict,
    status: res.status,
    key_fingerprint: fingerprint,
    detail:
      verdict === "valid_key_no_credit"
        ? "The key is valid, but the account it belongs to has no credit. If you topped up, it was a different account from the one this key belongs to."
        : verdict === "bad_key"
          ? "Anthropic rejected the key itself. This deploy is holding an old or revoked key."
          : text.slice(0, 300),
  });
}
