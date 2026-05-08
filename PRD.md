# PRD: ETC Solar Talent Conversational Assessment System

> **Build target:** Working web prototype — Next.js (App Router) + Supabase. Zoho integration deferred to Phase 4.
> **Phase 1 scope:** MCQ + branching + per-question timer. Voice/file/open-ended deferred.
> **Owner:** Ugo · **Reviewer:** Simeon · **Stack decision:** Locked.

---

## 0. Read this first (Claude Code)

You are building a production-grade prototype, not a throwaway. Everything you ship in Phase 1 must:

1. Be runnable with `pnpm dev` after a single `pnpm install`.
2. Use TypeScript strict mode. No `any` unless justified in a comment.
3. Use the **ETC brand palette** (defined in §6). No generic Tailwind defaults like `blue-500`, `slate-900`, etc.
4. Default to **mobile-first** layouts. Test at 375px width before 1280px.
5. Treat the candidate UI as a **chat**, not a form. One question at a time. Animate transitions.
6. Persist every keystroke/answer to Supabase optimistically. Never lose candidate progress on refresh.

If a requirement here conflicts with a habit you have, the requirement wins. Ask before deviating.

---

## 1. Product summary

A conversational assessment platform that vets 1,500+ candidates per program for ETC's solar tech and BD pipeline. Candidates answer one question at a time in a chat-style UI. Admins build assessments visually. Scoring, branching, and timing are configured per question.

**This is not a quiz tool.** It is a talent intelligence layer. Every answer becomes structured data for downstream routing (CRM, training, deployment).

---

## 2. Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server actions, streaming, route handlers |
| Language | TypeScript (strict) | Type safety across DB ↔ UI |
| Database | Supabase (Postgres) | RLS, realtime, free tier scales to 1.5k |
| Auth | Supabase Auth | Email magic link for admins; anonymous sessions for candidates |
| ORM | Drizzle | Type-safe SQL, lightweight migrations |
| UI | Tailwind CSS + shadcn/ui | Composable, themeable to ETC brand |
| Forms | React Hook Form + Zod | Validation that mirrors DB schema |
| State | Zustand (assessment session only) | Avoid Redux overhead |
| Animation | Framer Motion | Chat transitions, timer pulses |
| Deployment | Vercel | Zero config, works with Supabase |
| Package mgr | pnpm | Lock to pnpm; no npm/yarn |

**Do not add libraries outside this list without flagging it first.**

---

## 3. Data model (Phase 1)

Single source of truth. Every Drizzle schema, Zod validator, and TypeScript type is derived from this.

### `assessments`
| Column | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| title | text | "Solar Tech — POD Vetting Q2 2026" |
| slug | text (unique) | `/assess/[slug]` |
| role_type | enum | `tech` \| `bd` |
| status | enum | `draft` \| `published` \| `archived` |
| pass_threshold | int | Score % to pass (e.g. 70) |
| intro_text | text | Shown before Q1 |
| outro_text | text | Shown after final Q |
| created_at, updated_at | timestamptz | |

### `questions`
| Column | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| assessment_id | uuid (fk) | cascade delete |
| order_index | int | Drag-to-reorder support |
| type | enum | Phase 1: `mcq`, `true_false`. Schema includes `open`, `voice`, `file`, `formula` for forward-compat but UI hides them. |
| question_text | text | |
| options | jsonb | `[{id: 'a', label: 'Yes'}, ...]` |
| correct_answer | jsonb | `['a']` (array supports multi-select later) |
| points | int | Default 1 |
| negative_points | int | Default 0. Subtracted on wrong answer. |
| timer_enabled | boolean | |
| time_limit_seconds | int (nullable) | Required if `timer_enabled=true` |
| timeout_action | enum | `auto_submit` \| `skip` \| `mark_incorrect` |
| required | boolean | Default true |
| section | text (nullable) | For weighted scoring later |

### `branching_rules`
Lightweight rule engine. Evaluated after each answer.
| Column | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| assessment_id | uuid (fk) | |
| from_question_id | uuid (fk) | |
| condition | jsonb | `{op: 'score_gte', value: 70}` or `{op: 'answer_equals', value: 'a'}` |
| action | jsonb | `{type: 'jump_to', target_question_id: 'uuid'}` or `{type: 'skip_section', section: 'advanced'}` |
| priority | int | Lower = evaluated first |

### `responses`
One row per candidate session.
| Column | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| assessment_id | uuid (fk) | |
| candidate_name | text | |
| candidate_email | text | |
| candidate_phone | text | |
| started_at | timestamptz | |
| submitted_at | timestamptz (nullable) | Null = in progress |
| total_score | int (nullable) | Computed on submit |
| max_possible_score | int | Snapshot at submit time |
| status | enum | `in_progress` \| `submitted` \| `abandoned` |
| pass | boolean (nullable) | Computed on submit |
| metadata | jsonb | UA, IP hash, time-on-task |

### `answers`
| Column | Type | Notes |
|---|---|---|
| id | uuid (pk) | |
| response_id | uuid (fk) | |
| question_id | uuid (fk) | |
| selected_options | jsonb | `['a']` |
| time_spent_seconds | int | |
| timed_out | boolean | |
| score_awarded | int | Computed at answer time |
| answered_at | timestamptz | |

**RLS rules:** admins full access via service role; candidates can only read/write their own `responses` + `answers` rows scoped by session token.

---

## 4. Project structure

```
/app
  /(candidate)
    /assess/[slug]/page.tsx          # Entry: name/email capture
    /assess/[slug]/session/page.tsx  # The chat UI
    /assess/[slug]/done/page.tsx     # Outro + score reveal logic
  /(admin)
    /admin/page.tsx                  # Dashboard (assessment list)
    /admin/assessments/[id]/edit     # Builder
    /admin/assessments/[id]/responses # Candidate review
  /api
    /sessions/route.ts               # POST start, PATCH update
    /answers/route.ts                # POST submit answer, returns next Q + branching result
    /score/[responseId]/route.ts     # POST finalize
/components
  /candidate
    ChatShell.tsx
    QuestionBubble.tsx
    AnswerInput.tsx                  # MCQ buttons, T/F toggle
    Timer.tsx
    ProgressBar.tsx
  /admin
    AssessmentForm.tsx
    QuestionEditor.tsx
    BranchingRuleEditor.tsx
    ResponseTable.tsx
/lib
  /db
    schema.ts                        # Drizzle schemas
    client.ts
  /assessment
    engine.ts                        # getNextQuestion(), evaluateBranching()
    scoring.ts                       # scoreAnswer(), finalizeResponse()
    validators.ts                    # Zod schemas
  /supabase
    server.ts
    client.ts
/styles
  globals.css                        # ETC brand tokens
/drizzle                             # Migrations
```

---

## 5. Behaviour spec

### 5.1 Candidate flow

1. Land on `/assess/[slug]`.
2. See intro card with `intro_text`, "Some questions are timed" notice, and **Start Assessment** button.
3. Submit name/email/phone → POST `/api/sessions` → receive `response_id` + session token in HTTP-only cookie.
4. Redirect to `/assess/[slug]/session`.
5. Chat UI mounts. First question slides in from below (300ms ease-out).
6. Candidate selects an MCQ option.
7. **Optimistic UI:** option highlights immediately. POST `/api/answers` in background.
8. Server returns `{next_question_id, score_so_far, is_complete}`.
9. Question bubble locks (greyed, no edit). Next question slides in.
10. Repeat until `is_complete=true` → redirect to `/done`.

### 5.2 Timer behaviour

- If `timer_enabled`, show countdown chip in the question header.
- Last 5s: chip pulses + turns marigold → red.
- On timeout, dispatch the configured `timeout_action`.
- Timer state lives client-side but timestamps are validated server-side. If client clock drift > 3s, server's truth wins.
- Server records both `time_spent_seconds` (client-reported) and the server delta between question-shown and answer-received. Use the smaller of the two for `score_awarded` to defend against tampering.

### 5.3 Branching engine

After every answer:
1. Load all `branching_rules` for the current question, ordered by priority.
2. Evaluate first matching rule against current `response` state (`total_score_so_far`, last answer, section scores).
3. If a rule matches, its `action` overrides the default "next by `order_index`" behaviour.
4. If no rule matches, advance to the next question by `order_index`.
5. Record the path taken in `responses.metadata.path` for analytics.

Supported operators in v1: `score_gte`, `score_lte`, `answer_equals`, `answer_in`, `section_score_gte`.
Supported actions in v1: `jump_to`, `skip_to_end`, `skip_section`.

### 5.4 Scoring

```ts
// lib/assessment/scoring.ts
function scoreAnswer(question, selected, timedOut) {
  if (timedOut) {
    if (question.timeout_action === 'skip') return 0;
    if (question.timeout_action === 'mark_incorrect') return -question.negative_points;
    // auto_submit falls through to normal scoring
  }
  const correct = arraysEqual(selected.sort(), question.correct_answer.sort());
  return correct ? question.points : -question.negative_points;
}
```

Final score = sum of `answers.score_awarded`. Pass = `total_score / max_possible_score >= pass_threshold/100`.

### 5.5 Admin builder

- List view: all assessments with status, response count, avg score.
- Edit view: form for assessment metadata + drag-to-reorder question list.
- Question editor (modal or side panel): all fields from §3 with conditional reveals (timer fields hidden until `timer_enabled` is on).
- Branching rule editor: per-question, "If [condition] then [action]" rows.
- Preview button: opens candidate flow in new tab with `?preview=true` (doesn't write to `responses`).

### 5.6 Admin response review

- Table: candidate name, score, pass/fail, submitted_at, time-on-task.
- Click row → drill-in showing every Q+A with timing and branching path.

---

## 6. Design system (ETC brand — non-negotiable)

```css
:root {
  --etc-marigold: #f1b240;  /* CTAs, accents, timer alert */
  --etc-cream:    #fffadb;  /* Page bg */
  --etc-black:    #020301;  /* Text, nav */
  --etc-gray:     #f3f5f9;  /* Section dividers, locked states */
  --etc-white:    #ffffff;  /* Cards, chat bubbles */
}
```

**Color distribution:** 60% cream/white surfaces · 30% gray/black structure · 10% marigold accents.

### UI rules
- Chat bubbles: white card, 1px gray border, 16px radius, soft shadow `0 1px 3px rgba(2,3,1,0.06)`.
- MCQ buttons: cream fill, gray border, hover → marigold border. Selected → marigold fill, black text.
- Primary CTA: marigold bg, black text, font-weight 600, 12px radius.
- Body font: Inter (or Geist). Headings: weight 700.
- Mobile breakpoint baseline: 375px. Touch targets ≥ 44px.

Tailwind config must extend with these tokens — no inline hex anywhere in components.

---

## 7. Acceptance criteria

Phase 1 is done when **all** of these pass:

- [ ] `pnpm install && pnpm db:push && pnpm dev` runs the app on localhost:3000 with zero errors.
- [ ] Seed script creates one demo assessment with 8 MCQ questions, 2 timed, 2 with branching rules.
- [ ] A candidate can complete the demo assessment on a 375px viewport without horizontal scroll.
- [ ] Refreshing the page mid-assessment resumes from the last unanswered question.
- [ ] Admin can create a new assessment, add 5 questions with timers and branching, and preview it — all without writing code or SQL.
- [ ] Admin response table renders 100 seeded fake responses in under 500ms.
- [ ] Negative marking works: a -1 question subtracts 1 from total when wrong.
- [ ] Timeout with `mark_incorrect` applies negative points correctly.
- [ ] Branching rule `score_gte: 80 → jump_to: advanced_q1` skips intermediate questions when triggered.
- [ ] No `any` in `/lib`. No raw hex colors outside `globals.css` and Tailwind config.
- [ ] README documents env vars, setup, and the demo admin login.

---

## 8. Out of scope (Phase 1)

Do not build, do not stub elaborately:
- Voice recording / file upload UI (schema includes columns; UI ignores them)
- Open-ended text or formula questions
- AI auto-grading
- Zoho CRM/Flow/Campaigns/WorkDrive integration
- Email automation (log "would send" to console)
- Proctoring or anti-cheat
- Multi-language i18n
- Advanced analytics (basic counts only)

---

## 9. Risks Claude Code must actively defend against

| Risk | Mitigation |
|---|---|
| Candidate loses progress on refresh | Persist every answer immediately; resume from `responses` row keyed by session cookie |
| Mobile timer drift on slow networks | Server validates time-on-question; client timer is advisory |
| Admin builds invalid branching (cycle) | On rule save, run cycle detection; reject with error |
| 1500 concurrent candidates hammer DB | Use connection pooler; index `(response_id, question_id)` on answers |
| MCQ button mis-tap on mobile | 44px min touch target; 8px gap between options |
| Negative marking confuses candidates | Show score impact preview on intro screen; mention "wrong answers may deduct points" |

---

## 10. Slash commands (use these to drive the build)

Run these in order. Each command is self-contained — Claude Code can execute it without re-reading prior commands, but assumes prior commands succeeded.

### `/scaffold`
Initialize the Next.js 15 app with TypeScript strict, Tailwind, shadcn/ui, Drizzle, Supabase client, Zustand, Framer Motion, React Hook Form, Zod. Set up pnpm workspace. Configure Tailwind with ETC brand tokens (§6). Create folder structure from §4 with empty placeholder files. Add `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Write README §1 (setup) and §2 (dev workflow).

### `/db`
Implement the full Drizzle schema for §3. Generate the initial migration. Write `pnpm db:push` and `pnpm db:seed` scripts. Seed script creates: 1 admin user, 1 demo assessment ("Solar Tech POD Vetting — Demo") with 8 MCQ questions covering installation/safety/sizing, 2 of them timed (30s and 15s), 2 branching rules (one score-based, one answer-based), and 100 fake completed responses with realistic score distributions.

### `/engine`
Build `lib/assessment/engine.ts` and `lib/assessment/scoring.ts` per §5.3 and §5.4. Pure functions, fully unit-tested with Vitest. Export `getNextQuestion(responseId)`, `evaluateBranching(response, lastAnswer, rules)`, `scoreAnswer(question, selected, timedOut)`, `finalizeResponse(responseId)`. Tests must cover: correct/incorrect MCQ, timeout with each of the 3 actions, score-based branching trigger, answer-based branching trigger, no-rule-matches fallback, branching cycle detection.

### `/api`
Implement route handlers in `/app/api`:
- `POST /api/sessions` — create response row, set HTTP-only session cookie
- `GET /api/sessions/current` — resume in-progress session
- `POST /api/answers` — validate, score, persist, evaluate branching, return next question
- `POST /api/score/[responseId]` — finalize and return score breakdown
All handlers use Zod for input validation, return typed responses, and have RLS-aware Supabase clients.

### `/candidate-ui`
Build the chat-style candidate experience in `/app/(candidate)`. Use Framer Motion for question slide-in (y: 20 → 0, opacity: 0 → 1, 300ms). Optimistic UI on MCQ tap. Timer component with last-5-seconds pulse. Progress bar at top showing `currentIndex / totalQuestions`. Mobile-first: test at 375px first, then scale up. Resume-on-refresh works via `/api/sessions/current`. Use Zustand for in-flight session state only.

### `/admin-ui`
Build the admin experience in `/app/(admin)`. Magic link auth (Supabase). Assessment list with status badges and metrics. Question editor with conditional fields (timer reveals time_limit + timeout_action when enabled). Drag-to-reorder using `@dnd-kit/sortable`. Branching rule editor with operator/action dropdowns. Response table with sortable columns and drill-in modal showing per-question timing and chosen path.

### `/polish`
Run all acceptance criteria from §7. Fix anything that fails. Add loading states for every async boundary. Add error boundaries at route level. Ensure no console errors or warnings. Verify mobile UX at 375px in real browser DevTools. Update README with screenshots and the demo flow. Add a `pnpm typecheck` and `pnpm lint` script and ensure both pass.

### `/zoho-prep` *(don't run yet — Phase 4)*
Identify all integration points where Zoho will plug in (CRM contact creation on session start, WorkDrive for future file uploads, Campaigns for outro emails, Flow for routing). Add TODO comments with the exact payload shape and the Zoho endpoint that will be called. Do not implement.

---

## 11. Definition of "done" for each command

After running each `/command`, Claude Code must:
1. Print the list of files created/modified.
2. Run `pnpm typecheck` and report results.
3. Run any tests added in that command and report pass/fail.
4. State the next command to run.

If any step fails, stop and surface the error before moving on. Don't paper over failures.

---

## 12. Opening prompt for Claude Code

> You're building the ETC Solar Talent Assessment System per `PRD.md` in this repo. Read the entire PRD before writing any code. Then execute `/scaffold`. After it completes successfully, wait for me to say "continue" before running `/db`. We'll go command by command.

Paste that prompt into Claude Code as the first message after this PRD is in the repo root.
