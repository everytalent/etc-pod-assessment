/**
 * Netlify scheduled function — fires every 5 min per netlify.toml.
 *
 * The actual worker logic lives in the Next.js API route at
 * /api/cron/process-authoring-queue. This file's only job is to proxy
 * to it with the shared-secret auth header. We keep the work inside
 * the Next.js route because all the @/lib imports it needs already
 * resolve there.
 *
 * Required env:
 *   WORKER_CRON_SECRET   shared secret matched server-side
 *   NEXT_PUBLIC_SITE_URL absolute base URL of the deployed site
 *
 * Failure modes (and why we tolerate them):
 *   - Missing env vars → function logs a warning and exits 0. The
 *     scheduler will keep firing; the moment the env is set the
 *     next tick succeeds. We don't want a misconfig to fill the
 *     Netlify logs with red failures.
 *   - Underlying route 5xx → return non-200 so Netlify surfaces it
 *     in the function logs.
 */

import type { Config } from "@netlify/functions";

export default async function handler() {
  const secret = process.env.WORKER_CRON_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.URL;

  if (!secret || !baseUrl) {
    console.warn(
      "[scheduled-process-authoring-queue] skipped — missing WORKER_CRON_SECRET or NEXT_PUBLIC_SITE_URL/URL env",
    );
    return new Response("missing env, skipped", { status: 200 });
  }

  const res = await fetch(`${baseUrl}/api/cron/process-authoring-queue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(
      `[scheduled-process-authoring-queue] upstream ${res.status}: ${body.slice(0, 300)}`,
    );
    return new Response(body, { status: res.status });
  }
  return new Response(body, { status: 200 });
}

export const config: Config = {
  // The actual schedule is set in netlify.toml under
  // [functions."scheduled-process-authoring-queue"], but specifying it
  // here too is harmless and clearer for anyone reading the function file.
  schedule: "*/5 * * * *",
};
