# Skillboard Worker — Railway Setup

**Date:** 2026-06-05
**Status:** New Railway service for permanent fix on Opus/Netlify timeout
**Replaces:** the synchronous Netlify cron worker (which keeps running as a
backstop). The new Railway worker is the primary; cron is the safety net.

## Why

Netlify's serverless function timeout (~30s on standard plans, 90s on
background functions on this plan) was killing Opus calls mid-flight.
Every skillboard creation needed manual `pnpm tsx scripts/drain-jobs.ts`
runs to push the queue through. A long-lived Node process avoids that
entirely.

## What this is

`scripts/run-worker.mts` is a long-lived loop that:

1. Resets stuck `in_progress` rows older than 5 min (in case Railway
   restarts mid-job).
2. Polls the queue every 3 seconds.
3. Processes the oldest pending job via the same
   `processNextAuthoringJob` the Netlify cron uses.
4. Emits a heartbeat every 60 s so Railway can confirm liveness.
5. Handles SIGTERM gracefully (Railway deploy / restart).

## One-time Railway setup

### 1. Create a new Railway service

You probably have an existing project for Onboarding. Two options:

- **Same project, new service** — cleaner billing. In the Onboarding
  Railway project, click **+ New** → **Empty service**. Name it
  `skillboard-worker`.
- **New project** — pure isolation. Click **+ New Project** →
  **Empty project**. Name it `etc-skillboard-worker`.

Either works.

### 2. Connect this repo

Service → **Settings** → **Source** → **GitHub repo** →
`everytalent/etc-pod-assessment` → branch `main`.

Railway picks up `railway.json` automatically. That file tells Railway:

- Build: `pnpm install --frozen-lockfile --prod=false`
- Run: `pnpm worker`
- Restart on crash, max 10 retries
- 1 replica (don't multi-instance — would cause duplicate Opus calls)

### 3. Add env vars

Service → **Variables** → **Raw editor** → paste:

```env
DATABASE_URL=<from Supabase Project Settings → Database → Connection string (Pooler)>
ANTHROPIC_API_KEY=<same value as on Netlify>
ASSESSMENT_GEMINI_KEY=<same value as on Netlify>
KIMI_API_KEY=<same value as on Netlify>
ETC_ASSESSMENT_SERVICE_TOKEN=<same value as on Netlify and Onboarding>
ONBOARDING_API_URL=https://etc-os-api-production.up.railway.app
NEXT_PUBLIC_SUPABASE_URL=<same value as on Netlify>
SUPABASE_SERVICE_ROLE_KEY=<same value as on Netlify>
NODE_ENV=production
```

You'll already have most of these in another Railway service (Onboarding).
Copy them across.

### 4. Deploy

Railway auto-deploys on push to `main`. The first deploy might take 3-5
minutes (full pnpm install).

### 5. Verify

Service → **Logs**. You should see, within ~30 seconds of deploy:

```
[worker] starting · db=aws-0-eu-west-1.pooler.supabase.com
[worker] heartbeat · processed=0 failed=0
```

Then as soon as any pending job exists in the queue:

```
[worker] ok board=75fd862f 36280ms
[worker] ok board=75fd862f 33292ms
...
```

If you don't see the heartbeat within 60 seconds, check:

- **Build failed**: Railway logs will show pnpm install errors.
- **Missing env**: worker logs `[worker] FATAL: DATABASE_URL not set`
  and exits with code 1, which triggers Railway's restart-on-failure.
- **DB unreachable**: worker keeps looping, logging
  `[worker] loop error: ... — backing off 5s` every 5 seconds.

### 6. Keep the Netlify cron alive as a backstop

Don't disable
`netlify/functions/scheduled-process-authoring-queue-background.mts`.
If Railway is down for any reason (deploy, network issue, hitting
plan limits) the cron tick will still drain at least one job every
5 minutes. Belt and braces — costs nothing extra.

## Monitoring

- **Logs**: Railway dashboard shows live tail; export to a file with the
  CLI if needed (`railway logs`).
- **Heartbeat**: every 60 seconds. If you see a gap > 5 min the worker
  has crashed and Railway is mid-restart.
- **Queue depth**: run `pnpm tsx scripts/drain-jobs.ts` from local to see
  the current histogram (it's safe to run alongside the worker — both
  use atomic row-claim).

## Cost

Hobby plan on Railway is $5/month per service. A long-lived Node
process polling Postgres every 3s burns a fraction of a vCPU, well
within the Hobby plan's compute allowance.

## Future improvements (deferred)

- Multi-worker concurrency (current setup is 1 replica, sequential jobs;
  if a single Opus call ever becomes the bottleneck across many boards,
  bump replicas with care — atomic SELECT/UPDATE row-claim is in
  place, so 2-3 should be safe).
- Prometheus metrics endpoint (today: heartbeat + log lines only).
- Slack/Cliq alert if heartbeat gap > 5 min.
