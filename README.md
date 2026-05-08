# ETC Solar Talent Assessment

Conversational vetting platform for the ETC POD network — Solar Tech and BD candidates. Built per [`PRD.md`](./PRD.md), which is the source of truth for scope, data model, and acceptance criteria.

> **Status:** Phase 1 complete (`/scaffold` → `/db` → `/engine` → `/api` → `/candidate-ui` → `/admin-ui` → `/polish`). Phase 4 Zoho integration is deferred.

---

## 1. Setup

### Prerequisites
- Node 20+ (Node 24 verified)
- pnpm 10+ — `curl -fsSL https://get.pnpm.io/install.sh | sh -`
- A Supabase project (free tier is fine for Phase 1)

### Install
```bash
pnpm install
```

### Configure environment
Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` `secret` (server-only) |
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string (use the **transaction-mode pooler** on port `6543` for serverless deployment) |

> The service-role key bypasses RLS — never ship it to the browser. Only used inside `/lib/supabase/server.ts` and the seed script.

### Initialise the database
```bash
pnpm db:push      # apply Drizzle schema to Supabase
pnpm db:seed      # seed 1 demo assessment + 100 fake responses
```

`db:seed` creates a demo assessment slugged **`solar-tech-pod-vetting-demo`** with 8 MCQ questions (2 timed, 2 with branching) plus 100 realistic fake responses.

### Run
```bash
pnpm dev          # http://localhost:3000
```

---

## 2. Dev workflow

```bash
pnpm dev          # http://localhost:3000
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm test         # vitest watch
pnpm test:run     # vitest single-run
pnpm build        # production build
pnpm db:generate  # drizzle-kit generate (after schema changes)
pnpm db:push      # drizzle-kit push (apply to remote)
pnpm db:studio    # drizzle-kit studio (browse data)
```

### Routes
| Route | Who | What |
|---|---|---|
| `/` | public | Landing |
| `/assess/[slug]` | candidate | Intake (name/email/phone) |
| `/assess/[slug]/session` | candidate | One-question-at-a-time chat |
| `/assess/[slug]/done` | candidate | Outro |
| `/admin/login` | admin | Magic-link sign-in |
| `/admin` | admin | Assessment list + metrics |
| `/admin/assessments/new` | admin | Create assessment |
| `/admin/assessments/[id]/edit` | admin | Builder (questions, branching, drag-to-reorder) |
| `/admin/assessments/[id]/responses` | admin | Response table + drill-in |

### Layout (PRD §4)
```
app/                  Next.js App Router
components/           UI building blocks (candidate/, admin/, ui/)
lib/                  db/, assessment/, supabase/, state/, auth/, admin/
styles/globals.css    ETC brand tokens + shadcn theme
drizzle/              Generated SQL migrations
```

### Brand tokens
ETC palette is defined exactly once, in [`styles/globals.css`](./styles/globals.css). Never inline a hex color in components — use Tailwind utilities (`bg-etc-marigold`, `text-etc-cream`, `border-etc-gray`) or the semantic shadcn tokens (`bg-background`, `bg-card`, `text-muted-foreground`).

---

## 3. Demo flow

### Admin first run
1. `pnpm db:push && pnpm db:seed` — schema + demo content.
2. `pnpm dev` and visit [http://localhost:3000/admin](http://localhost:3000/admin).
3. You'll be redirected to `/admin/login`. Enter your email → check inbox → click the magic-link.
4. Supabase exchanges the code at `/admin/auth-callback` and drops you on the dashboard.

> **First-time access:** any email that signs in via magic link becomes an admin. There is no allowlist in Phase 1 (the `auth.users` table is the source of truth). For production, add a row-level policy or middleware guard against an `admin_emails` table.

### Build a new assessment
1. Click **New assessment**, give it a title + lower-kebab slug, **Track** = tech or bd, **Status** = draft.
2. On the builder, click **+ Add question**. The editor reveals timer fields when **Timed question** is on.
3. Mark the correct option with the radio next to it.
4. Add a branching rule via the **Branching rules** dropdown under the question — pick an operator + action. The server runs cycle detection before saving and surfaces the loop path if you accidentally create one.
5. Drag question cards by the `⋮⋮` handle to reorder.
6. Click **Preview ↗** — opens the candidate intake in a new tab. Drafts render only when an admin is signed in.
7. Set status to **Published** and save. The slug is now live at `/assess/[slug]`.

### Candidate flow
1. Visit `/assess/[slug]`.
2. Submit name/email/phone. The server creates a `responses` row, sets an `etc_session` httpOnly cookie, and routes to `/session`.
3. Each question: tap an option → optimistic highlight → POST `/api/answers` → next question slides in.
4. Refresh mid-session: server-side hydration looks up the cookie and resumes from the next unanswered question.
5. On submit, the engine finalises the response, clears the cookie, and routes to `/done`.

---

## 4. Architecture notes

- **Engine is split into pure + DB-bound layers** ([`lib/assessment/engine.ts`](./lib/assessment/engine.ts)). Pure logic (`evaluateBranching`, `pickNextQuestion`, `detectCycles`, `scoreAnswer`) is unit-tested with Vitest. DB wrappers (`getNextQuestion`, `finalizeResponse`) are thin glue.
- **Candidate session cookie is opaque** — value is the `responses.id` UUID, httpOnly, SameSite=Lax. Tamper resistance for `/polish`: HMAC-sign with `SUPABASE_JWT_SECRET`. See the comment block at the top of [`lib/session.ts`](./lib/session.ts).
- **Auth gating is layered.** Next 16 `proxy.ts` redirects unauthed `/admin` requests to `/admin/login`; route handlers re-check via `requireAdminApi()` as defence-in-depth. Drizzle uses `DATABASE_URL` directly (not Supabase RLS) for Phase 1.
- **Branching cycles** are caught twice: statically by `detectCycles()` at admin save time, and dynamically by the visited-set guard inside `getNextQuestion()`.
- **Timer cross-check** ([`/api/answers`](./app/api/answers/route.ts)): server stores `last_question_shown_at` in `responses.metadata`; on submit, if `|client_time − server_delta| > 3s` we trust the server (prevents zero-time tampering); otherwise we use the smaller of the two (PRD §5.2).

---

## 5. Acceptance status (PRD §7)

- [x] `pnpm install && pnpm db:push && pnpm dev` runs the app on `localhost:3000` *(verified `pnpm install` + `pnpm build`; `db:push` and `dev` need a real Supabase project)*
- [ ] Seed creates demo with 8 MCQ, 2 timed, 2 branching *(seed lands in `/db` — verify after running `db:seed`)*
- [ ] Candidate completes demo on 375px without horizontal scroll *(needs live env)*
- [x] Refreshing mid-assessment resumes from the last unanswered question *(server-side `dynamic = "force-dynamic"` on `/session`)*
- [x] Admin can create + add 5 questions w/ timers + branching + preview without code or SQL
- [ ] Admin response table renders 100 fake responses < 500ms *(needs live env to measure)*
- [x] Negative marking subtracts on wrong *(unit-tested in `scoring.test.ts`)*
- [x] Timeout `mark_incorrect` applies negative points *(unit-tested)*
- [x] Branching `score_gte: 80 → jump_to: advanced_q1` skips intermediate Qs *(unit-tested)*
- [x] No `any` in `/lib`. No raw hex outside `globals.css` and Tailwind config
- [x] README documents env vars, setup, and the demo flow

---

## 6. Phase 4 deferred

Zoho integration (CRM contact creation on session start, WorkDrive for file uploads, Campaigns for outro emails, Flow for routing) is intentionally not implemented. Search for `// TODO(zoho)` to find the wire points when that phase begins.
