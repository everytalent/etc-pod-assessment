# Solar Talent Conversational Assessment System (POD Vetting)

**Date:** 2026-05-04 (original) · 2026-05-11 (revision 2)
**Author:** Ugo
**Status:** Live — Renewvia assessment in production at `assess.energytalentco.com`
**Simeon review required:** Yes

> **About this revision**
> The PRD has been updated in place to reflect everything shipped since the original draft. Items added or substantively changed are tagged `[ADDED]`, `[CHANGED]`, or `[DONE]`. The original structure is preserved; new behaviour sections sit alongside the originals rather than replacing them.

---

## Problem

Energy Talent Company requires a scalable, intelligent system to vet candidates for:

- Solar Tech roles
- Business Development (BD) roles
- POD-based deployments

Current challenges:
- Manual vetting does not scale
- Inconsistent evaluation quality
- Poor candidate experience
- No structured data for decision-making

Target:
→ Handle 1500+ applicants per program efficiently
→ Maintain high-quality evaluation
→ Create an engaging, modern candidate experience

---

## Core Objective

Build a **bot-like conversational assessment system** that:

- Feels like a chat, not a test
- Evaluates candidates across multiple dimensions
- Prioritises multiple-choice for scalability
- Supports rich responses (voice, file, text)
- `[CHANGED]` Built on Next.js + Supabase + Drizzle, not on Zoho Creator. Zoho integration is now a side channel (WorkDrive export + audio archive) rather than the primary engine.
- Automates scoring, tagging, and follow-up
- `[ADDED]` Augments human review with AI: dual-AI cross-check on open-ended scoring, with audit-friendly attribution.

---

## Scope

### Included

Assessment Engine:
- Multiple choice (PRIMARY) `[DONE]`
- Open-ended (text) `[DONE]`
- Voice recording / upload `[DONE]` — MediaRecorder API with 5-minute cap, "Type instead" fallback at any point.
- File upload — schema present, candidate UI not yet built
- True/False — schema present, candidate UI not yet built
- Fill in the blanks — not built
- Matching — not built
- Formula/calculation questions — schema present, validator not yet built

Scoring:
- Configurable points per question `[DONE]`
- Negative marking for incorrect answers `[DONE]`
- Section-based weighting `[DONE]` — via `questions.section` text label

`[ADDED]` AI-Assisted Scoring (Plan C):
- Per-question free-form scoring rubric (`questions.scoring_rubric`).
- Voice transcription via Gemini 2.5 Flash, persisted on the answer row.
- Auto-score suggestion via Gemini 2.5 Pro using the rubric + transcript / text.
- Dual-AI cross-check: 1st assessor (Gemini) scores all open-ended answers, 2nd assessor (Kimi / Moonshot) re-scores a random sample of 3. If mean abs diff ≤ 1.0 → Kimi-agrees, Gemini stands. If > 1.0 → Kimi rescores everything and overrides. Outcome is stored on `responses.ai_consensus`.
- Per-answer re-assess button to re-run a single provider on a single answer.
- Bulk "Accept all AI suggestions" per response (consensus-winner provider chosen automatically).
- Bulk run AI scoring / accept across multiple responses from the response list.
- Score source attribution on every save: `manual` / `ai_gemini` / `ai_kimi`. Visible in the drill-in.

Timing Controls:
- Per-question timer (optional) `[DONE]`
- Per-question time limit `[DONE]`
- Auto-submit or skip on timeout `[DONE]`
- `[ADDED]` Realistic time-to-complete range on the intake screen (40–65 % of full timer budget) instead of the worst-case sum, so candidates don't plan around the ceiling.

Candidate Experience:
- Conversational (one question at a time) `[DONE]`
- Mobile-first design `[DONE]`
- Seamless progression `[DONE]`
- `[ADDED]` Sticky progress bar pinned to the top of the viewport with `Question N of total · X%`.
- `[ADDED]` Refresh-resume: hard refresh re-renders the active question AND the prior locked-bubble history hydrated from the DB, so a poor-connection candidate in the field never loses progress.
- `[ADDED]` Session-load counter (soft audit signal) shown in the admin drill-in.
- `[ADDED]` Mobile-aware microphone permission recovery — "Try again" re-fires the permission prompt; if browser has hard-denied, route-specific copy (iOS Safari / iOS Chrome / Android Chrome / desktop Chromium / Firefox) explains how to enable mic.
- `[ADDED]` Friendly candidate error page with "Email the team" mailto button and a reference id pre-filled.

Admin System:
- Assessment builder `[DONE]`
- Question manager `[DONE]` — with inline editor, drag-reorder, per-question rubric textarea for AI scoring.
- Candidate review dashboard `[DONE]` — sortable, with selection mode + bulk delete + bulk AI actions.
- Scoring + tagging system — scoring `[DONE]`; tagging deferred (Zoho CRM integration).
- `[ADDED]` Role-tier system with 4 levels: `superadmin` > `admin` > `editor` > `assessor`. Each tier has a capability matrix (CAN.editAssessments, CAN.deleteResponses, etc.).
- `[ADDED]` Invite flow — admin tier and up can invite new users with role-grant restrictions (admin can grant editor/assessor; superadmin can grant any role including other superadmins).
- `[ADDED]` Per-assessment visibility flag (`listed` / `unlisted`) so published assessments can be link-only without appearing on the public landing.
- `[ADDED]` Public candidate landing at `/` listing all `published + listed` assessments as branded cards.
- `[ADDED]` Admin preview mode (cookie-gated) so admins can take a draft for QA.
- `[ADDED]` Assessment + response delete (single + selection-mode bulk).
- `[ADDED]` Score-source analytics card on `/admin` dashboard — system-wide totals (Manual / 1st assessor / 2nd assessor) plus per-assessor breakdown.
- `[ADDED]` Feature flag UI at `/admin/settings` (superadmin only) to toggle which roles see AI scoring — rolls out broader access without a redeploy.
- `[ADDED]` Integrity signals panel in the response drill-in: session loads, tab switches, paste events, IP change. All soft; never auto-blocking; copy explicitly mentions field connectivity as a benign cause.

Automation:
- Email follow-ups `[DONE via Resend]` — system mail (magic-link, invite, archive summary) goes through Resend SMTP with verified `energytalentco.com` domain. Zoho Campaigns deferred for marketing-style outbound.
- Candidate routing — pending (Zoho CRM/Flow integration not yet wired).
- CRM updates — pending.

`[ADDED]` Infrastructure & Auth:
- Custom domains: `admin.energytalentco.com` (admin) and `assess.energytalentco.com` (candidate / Renewvia). Host-gated in `proxy.ts` so cookies don't leak between admin and candidate flows.
- Supabase magic-link auth with branded Resend-backed templates (Invite user, Magic Link, Confirm signup) using `token_hash` flow (no PKCE verifier required on the invitee's browser).
- Two-layer auth: Supabase verifies email; `admin_users` allowlist gates the dashboard.

`[ADDED]` Zoho WorkDrive integration:
- OAuth Self Client refresh token flow.
- Per-assessment folder hierarchy `<root>/etc-pod-archive/<slug>/`.
- "Export to Zoho Sheet" CSV upload to the assessment folder.
- Optional "Archive audio" checkbox — moves voice answers to WorkDrive in batches of 10, marks `audio_path` with `zoho:<file_id>` prefix.
- Drill-in audio playback resolver: Supabase signed URL when fresh, direct WorkDrive link when archived.
- Summary email via Resend on archive completion.

---

### Explicitly Excluded (Phase 1)

- AI auto-grading of essays/voice → **NOW INCLUDED** as `[ADDED]` Plan C: dual-AI cross-check with human override.
- Proctoring / anti-cheat systems → **PARTIALLY INCLUDED** as soft signals (session loads, tab blur, paste, IP change). Hard proctoring (webcam, screen capture) still out of scope.
- Advanced analytics dashboards → **PARTIALLY INCLUDED** as score-source breakdown + per-assessor table. Larger analytics suite still out of scope.

---

## Behaviour

### 1. Entry Point

`[CHANGED]` Candidate lands on `https://assess.energytalentco.com/` (public landing). Lists all `published + listed` assessments. Clicking a card opens `/assess/<slug>`.

Original spec referenced `/sales` or `/technical`; the implementation generalises to one slug per assessment.

Direct link entry still works: `https://assess.energytalentco.com/assess/<slug>` — unlisted assessments are accessible this way only.

---

### 2. Session Initialization

System creates:
- Candidate record (`responses` row) with name, email, phone, assessmentId.
- Captures `start_ip_hash` (sha-256 of `x-forwarded-for`, truncated) at intake.
- Capture: name / email / phone / track (tech / BD) — track inferred from the assessment's `roleType`.

`[CHANGED]` Zoho CRM record creation deferred. Candidate state lives in Supabase Postgres.

---

### 3. Conversational Flow Engine

Assessment runs as:

FOR each question:
- Display ONE question only
- Wait for response
- Validate response
- Store response (POST /api/answers)
- Move to next question

No multi-page forms.
No overwhelming UI.

`[ADDED]` On refresh, the server hydrates BOTH the current question AND the locked-bubble history from `answers` joined to `questions`. The progress bar reads the correct N-of-total after refresh. No client cookies or localStorage involved.

`[ADDED]` Session-load counter increments on every render of the session page (1 = clean run; ≥4 = soft cheating signal in drill-in).

---

### 4A. Question Timing (Per Question Timer)

Each question can have an optional timer.

When a timer is set:
- Timer starts immediately when question is displayed
- Server-truth `last_question_shown_at` ISO timestamp on `responses.metadata`
- Countdown visible to candidate via the `Timer` chip in the question bubble
- Candidate must respond within allocated time

On timeout:
- `auto_submit` — evaluate partial answer if any
- `skip` — score = 0
- `mark_incorrect` — apply `negative_points`

---

### Recommended Timer Logic by Question Type

Multiple Choice — 10–30 s (scenario MCQ on Renewvia uses 90 s for read-and-decide)
True/False — 5–15 s
Open-ended — 60–180 s
Voice Response — 60–120 s recording limit (cap enforced at 5 minutes server-side)
File Upload — 120–300 s
Formula Questions — 30–90 s

---

### Candidate Experience

- Timer visible but not intrusive
- Warning indicator when time is almost up (last 5 s)
- Smooth transition to next question on timeout
- Clear instruction before assessment starts

`[ADDED]` Mobile-aware copy and recovery flows. iOS safe-area insets respected. Page padding / font sizes adjust on phones.

---

### 4B. Question Resume `[ADDED]`

When a candidate refreshes mid-assessment:

- Server reads the candidate session cookie.
- Server fetches the next unanswered question via the engine (DB-backed; not client state).
- Server fetches `getAnsweredHistory()` — past answers joined with their questions and shaped into locked-bubble entries.
- Both are hydrated into the ChatShell's Zustand store on first render.
- The progress bar reads the correct position; the chat shows the full prior path.

No re-questioning. No lost progress. Field engineers on flaky connections can refresh freely.

---

### 4C. Anti-Cheating Soft Signals `[ADDED]`

Tracked on `responses.metadata` (jsonb):

| Field | Increment trigger | Threshold for "warn" badge |
| --- | --- | --- |
| `session_loads` | `/session` Server Component render | ≥4 |
| `tab_blur_count` | `visibilitychange` → hidden | ≥3 |
| `paste_count` | `onPaste` on open-ended textarea | ≥1 |
| `start_ip_hash` vs `submit_ip_hash` | computed at intake / finalize | any difference |

All signals surface in the admin drill-in. None block the candidate; copy explicitly reminds reviewers that field connectivity / commuting can drive these up legitimately.

---

### 4. Question Type Handling

#### Multiple Choice (PRIMARY) — `[DONE]`

- Button-based selection
- Instant progression on click (optimistic highlight)
- Auto-scored immediately
- Phase 1: single-correct (radio behaviour)

#### Open-ended `[DONE]`

- Voice recorder by default (MediaRecorder, 5-minute cap)
- "Type instead" toggles to textarea (min 20 chars, max 4000)
- Both stored: `answers.text_response` OR `answers.audio_path`
- Voice answers playable in admin drill-in via 1-hour signed URL

#### Voice Response

- Direct browser-to-Supabase Storage upload (signed PUT URL, MIME stripped of `;codecs=...` for bucket allowlist match).
- `[ADDED]` Transcript via Gemini button in drill-in; persisted to `answers.transcript`.
- `[ADDED]` Once archived to Zoho, drill-in renders an "Open in WorkDrive" link rather than the inline `<audio>` player.

#### File Upload — schema enum present; candidate UI deferred.

#### Formula Questions — schema enum present; auto-validator deferred.

---

### 5. Scoring Logic

Each question has:
- `points`
- `negative_points`

Logic:
- IF correct → add points
- IF incorrect → subtract `negative_points`

`[ADDED]` Open-ended questions are not auto-scored from MCQ logic. Instead:
- Default `score_awarded = 0` until a reviewer saves a score.
- Range: 0..`points`.
- Save endpoint accepts an optional `source` field (`manual` / `ai_gemini` / `ai_kimi`), defaulting to manual.
- Drill-in shows the source as a badge: "Manual score" or "Accepted from 1st/2nd assessor".

### Timeout Handling

IF question times out:
- `auto_submit` → evaluate
- `skip` → score = 0
- `mark_incorrect` → apply `negative_points` if defined

---

### 5B. AI-Assisted Scoring `[ADDED]`

**Per-question rubric.** Author provides a free-form rubric on the question editor:

```
Required keywords (must hit 3 of 5):
- Earth resistance tester
- Earth continuity test
- Less than 5 ohms

Red flags:
- "Use multimeter only"
```

Stored as `questions.scoring_rubric`. Used verbatim in the AI prompt.

**One-off suggestion.** "✨ Suggest score" button on the drill-in fires Gemini 2.5 Pro with `(question + rubric + transcript|text + max points)` and returns `{ suggestedScore, rationale, hits, misses, redFlagsTriggered }`. Reviewer can Accept (fills the score input + tags source as `ai_gemini`) or override manually.

**Dual-AI cross-check pipeline ("Run AI scoring").** Per-response, step-based execution (each step is a single short request to satisfy Netlify's 26-s function budget):

1. `cross-check-plan` returns the list of scorable open-ended answers + which providers have already scored each.
2. Client iterates: 1st assessor (Gemini) for any answer missing a Gemini score.
3. 2nd assessor (Kimi) on a random sample of 3.
4. Client finalises: server computes mean abs diff. If ≤ 1.0 → consensus = `agree`. Else consensus = `override`.
5. If override → client iterates Kimi over the remaining answers, then finalises again.

State persisted on `responses.ai_consensus` (`pending`, `gemini_only`, `agree`, `override`) and on `ai_scores(answer_id, provider)` rows.

**Bulk operations.**
- "Accept all AI suggestions" per response — picks the consensus-winner provider, writes scores into `score_awarded` with source + audit columns, recomputes totals once.
- "Run AI on N" + "Accept AI on N" in response-list selection mode — iterates the per-response pipeline.

**Re-assess.** Each AI score card has a Re-assess button that re-runs that one provider on that one answer.

---

### 5C. Score Source & Reviewer Attribution `[ADDED]`

Every saved score writes:
- `score_awarded` — the live number
- `score_source` — `manual` / `ai_gemini` / `ai_kimi`
- `scored_by` — admin_users.id
- `scored_at` — timestamptz

Drill-in shows: "Last scored 14:32 by ugo@energytalentco.com (superadmin) [Accepted from 1st assessor (Gemini)]".

Dashboard rolls these up into the score-source analytics card.

---

### 6. Branching Logic

`[CHANGED]` Schema for `branching_rules` exists with `score_gte`, `score_lte`, `answer_equals`, `answer_in`, `section_score_gte` conditions and `jump_to`, `skip_to_end`, `skip_section` actions. **Authoring UI deferred** — no admin form yet to create rules. Engine code respects rules if rows are inserted via SQL.

---

### 7. Completion Flow

After submission:
- Score calculated (sum of `score_awarded`)
- `pass` computed against `pass_threshold`
- Data stored
- `[ADDED]` `submit_ip_hash` snapshotted onto metadata
- `[ADDED]` Candidate sees the `/done` page with the assessment's `outroText`

---

### 8. Admin Roles `[ADDED]`

Four tiers, ranked:

| Role | Capabilities |
| --- | --- |
| `superadmin` | All; only role that can grant other superadmins; sees feature flags page; always sees AI panels |
| `admin` | Editor + invite/remove editor & assessor users |
| `editor` | Assessor + author/edit assessments + export + archive |
| `assessor` | Read responses + score open-ended only |

AI-scoring visibility is gated by a configurable feature flag (see §9) AND by an assessor-specific rule: assessors only see AI on a given answer **after** they've saved their own score on that answer.

---

### 9. Feature Flags `[ADDED]`

`feature_flags(key, enabled_for_roles text[], updated_at, updated_by)` table.

Currently one flag: `ai_scoring_visibility`. Seeded with `['superadmin']` for the 1-month soak; superadmin flips additional roles in `/admin/settings` when ready to widen.

Server-side `loadAiScoringRoles()` reads the row, with env (`AI_SCORING_VISIBLE_TO`) as fallback. All AI-gated endpoints (`auto-score`, `cross-check-step`, `cross-check-plan`, `accept-ai-scores`, `responses/[id]`) call into the role check with the loaded set.

UI auto-hides AI panels and bulk-AI buttons when the viewer's role isn't allowed.

---

## Acceptance Criteria

- [x] Assessment runs in conversational (chat-like) format
- [x] One-question-at-a-time flow works seamlessly
- [x] Multiple-choice questions auto-score instantly
- [x] Negative marking is supported
- [x] Voice responses can be recorded/uploaded
- [ ] File uploads are supported and stored (deferred)
- [ ] Branching logic dynamically adjusts questions (engine exists, UI deferred)
- [x] System handles 1500+ candidates per assessment (Supabase pooler in transaction mode)
- [x] Admin can review all response types
- [x] Mobile-first UX works smoothly
- [x] `[ADDED]` Refresh during assessment does not lose progress
- [x] `[ADDED]` AI-suggested scores available to authorised reviewers
- [x] `[ADDED]` Score source and reviewer name visible in audit trail
- [x] `[ADDED]` Soft anti-cheating signals visible to reviewers (never auto-blocking)
- [x] `[ADDED]` Role-gated rollout: AI features can be enabled/disabled per role without redeploy

---

## Approach

`[CHANGED]` Stack:

| Layer | Original (Zoho-heavy) | Shipped |
| --- | --- | --- |
| Frontend | Zoho SalesIQ / custom | Next.js 16 App Router + Tailwind v4 + shadcn/ui + Framer Motion |
| Auth | — | Supabase magic-link + `admin_users` allowlist |
| State | — | Zustand (candidate session) |
| Engine | Zoho Creator | Drizzle ORM over Supabase Postgres |
| Storage | Zoho WorkDrive | Supabase Storage primary; Zoho WorkDrive for cold-tier archive |
| Email | Zoho Campaigns | Resend SMTP |
| AI | — | Gemini 2.5 Flash (transcription), Gemini 2.5 Pro (scoring), Moonshot Kimi (validation) |
| Hosting | — | Netlify (edge middleware + Next.js runtime) |

Zoho CRM / Flow remain integration targets but are not the runtime backbone.

---

## Data Model Changes

### Assessments
- id, title, slug (unique, lower-kebab)
- role_type (`tech` | `bd`)
- status (`draft` | `published` | `archived`)
- `[ADDED]` visibility (`listed` | `unlisted`)
- `[ADDED]` pass_threshold (int 0–100, percent)
- `[ADDED]` intro_text, outro_text (text)
- created_at, updated_at

### Questions
- id, assessment_id (cascade), order_index
- type (mcq | true_false | open | voice | file | formula)
- question_text, options (jsonb [{id, label}])
- correct_answer (text[])
- points, negative_points
- required
- timer_enabled, time_limit_seconds, timeout_action (auto_submit | skip | mark_incorrect)
- `[ADDED]` section (text, nullable — for grouping + analytics)
- `[ADDED]` scoring_rubric (text, nullable — drives AI scoring)

### Responses
- id, assessment_id (cascade)
- candidate_name, candidate_email, candidate_phone
- started_at, submitted_at
- total_score, max_possible_score
- status (in_progress | submitted | abandoned)
- pass (boolean)
- metadata (jsonb): user_agent, ip_hash, path[], time_on_task_seconds, last_question_shown_at, preview, **`[ADDED]` session_loads, tab_blur_count, paste_count, start_ip_hash, submit_ip_hash**
- `[ADDED]` ai_consensus (`pending` | `gemini_only` | `agree` | `override`)
- `[ADDED]` ai_pipeline_ran_at (timestamptz)

### Answers
- id, response_id (cascade), question_id (cascade)
- selected_options (jsonb string[]), text_response, audio_path
- audio_duration_seconds
- `[ADDED]` transcript (text — Gemini transcription)
- scored_by (admin_users.id), scored_at
- `[ADDED]` score_source (`manual` | `ai_gemini` | `ai_kimi`)
- time_spent_seconds, timed_out
- score_awarded
- answered_at

### `[ADDED]` admin_users
- id, email (unique, lowercase), role (`superadmin` | `admin` | `editor` | `assessor`)
- invited_by (self-FK)
- created_at

### `[ADDED]` ai_scores
- id, answer_id (cascade)
- provider (`gemini` | `kimi`)
- score, rationale, hits jsonb, misses jsonb, red_flags jsonb
- created_at
- Unique on (answer_id, provider)

### `[ADDED]` feature_flags
- key (pk), enabled_for_roles text[]
- updated_at, updated_by

### `[ADDED]` branching_rules (schema only — no authoring UI yet)
- id, assessment_id (cascade), from_question_id (cascade)
- condition jsonb (score_gte | score_lte | answer_equals | answer_in | section_score_gte)
- action jsonb (jump_to | skip_to_end | skip_section)
- priority

---

## API Changes

Candidate-facing (cookie-session):
- POST `/api/sessions` — start
- GET `/api/sessions/current`
- POST `/api/answers` — submit one answer; engine advances
- POST `/api/answers/voice/upload-url` — mint Supabase signed PUT URL
- POST `/api/sessions/signal` `[ADDED]` — increment tab_blur / paste counters

Admin (allow-listed):
- GET/POST `/api/admin/assessments`
- GET/PATCH/DELETE `/api/admin/assessments/[id]`
- GET/POST `/api/admin/assessments/[id]/questions`
- PATCH/DELETE `/api/admin/questions/[id]`
- POST `/api/admin/questions/reorder`
- GET `/api/admin/responses/[id]`
- DELETE `/api/admin/responses/[id]`
- POST `/api/admin/responses/bulk-delete`
- PATCH `/api/admin/answers/[id]/score`
- GET `/api/admin/answers/[id]/audio-url`
- POST `/api/admin/assessments/[id]/responses/export`
- POST `/api/admin/assessments/[id]/responses/export-zoho` `[ADDED]`
- POST `/api/admin/assessments/[id]/responses/archive-audio` `[ADDED]`
- POST `/api/admin/assessments/[id]/responses/archive-summary-email` `[ADDED]`
- POST `/api/admin/answers/[id]/transcribe` `[ADDED]`
- POST `/api/admin/answers/[id]/auto-score` `[ADDED]`
- POST `/api/admin/answers/[id]/cross-check-step` `[ADDED]`
- GET/POST `/api/admin/responses/[id]/cross-check-plan` `[ADDED]`
- POST `/api/admin/responses/[id]/accept-ai-scores` `[ADDED]`
- GET/POST `/api/admin/admin-users` `[ADDED]`
- GET/PATCH `/api/admin/feature-flags/[key]` `[ADDED]`

---

## Frontend Changes

Candidate:
- Public landing `/` listing `published + listed` assessments `[ADDED]`
- `/assess/<slug>` — intake form with realistic time-range pill `[ADDED: time-range]`
- `/assess/<slug>/session` — chat shell with sticky progress bar `[ADDED]`, refresh-resume `[ADDED]`, locked-bubble history, active question, AnswerInput
- `/assess/<slug>/done` — outro screen
- Friendly error boundary with support mailto + reference id `[ADDED]`

### Candidate UI

- Countdown timer displayed per question
- Visual urgency indicator (colour change near timeout)
- Smooth auto-transition when time expires
- Mobile-friendly mic permission recovery `[ADDED]`

Admin:
- `/admin` — assessment list + `[ADDED]` score-source analytics card
- `/admin/assessments/new`
- `/admin/assessments/[id]/edit` — question builder + drag-reorder + rubric textarea `[ADDED]`
- `/admin/assessments/[id]/responses` — sortable table with selection mode (bulk delete, `[ADDED]` bulk run AI, `[ADDED]` bulk accept AI)
- Response drill-in modal — `[ADDED]` integrity signals panel, AI cross-check panel, per-answer AI score cards with re-assess buttons, score-source badges, scorer attribution, transcript on voice answers
- `/admin/users` — admin user invite + list (admin tier+)
- `/admin/settings` `[ADDED]` — feature flag editor (superadmin only)

### Admin UI

- Ability to:
  - Enable/disable timer per question
  - Set time limit
  - Define timeout behaviour
  - `[ADDED]` Write a per-question scoring rubric for AI scoring
  - `[ADDED]` Toggle visibility (listed/unlisted)
  - `[ADDED]` Run / accept AI scoring per response or in bulk
  - `[ADDED]` Re-assess a single AI answer
  - `[ADDED]` Flip AI-scoring visibility per role (superadmin)

---

## Implementation Steps

Status as of 2026-05-11:

1. ✅ Design database schema
2. ✅ Build Drizzle data structure (was: Zoho Creator)
3. ✅ Build question engine
4. ✅ Implement conversational flow logic
5. ✅ Build MCQ system (priority)
6. ✅ Implement scoring + negative marking
7. ✅ Add open-ended responses (text + voice)
8. ✅ Add voice recording/upload
9. ⏳ Add file uploads (schema present, UI deferred)
10. ⏳ Build branching logic UI (engine exists, authoring UI deferred)
11. ⏳ Integrate Zoho CRM (deferred; WorkDrive instead)
12. ✅ Build admin dashboard
13. ⏳ Integrate Zoho Flow automation (deferred)
14. ✅ Test with real users (Renewvia assessment live)
15. ⏳ Optimize for scale (transaction-mode pooler done; further load testing pending)

`[ADDED]` additional steps shipped:
16. ✅ Auth (Supabase magic-link + admin_users allowlist)
17. ✅ Admin role tiers + invite flow
18. ✅ Resend SMTP + branded email templates
19. ✅ Zoho WorkDrive export + audio archive
20. ✅ AI transcription (Gemini Flash)
21. ✅ AI scoring rubrics + Gemini Pro suggestion
22. ✅ Kimi dual-AI cross-check pipeline
23. ✅ Role-gated AI visibility + Settings page
24. ✅ Score-source analytics
25. ✅ Anti-cheating soft signals
26. ✅ Mobile responsiveness pass
27. ✅ Renewvia assessment seeded (17 questions w/ rubrics)

---

## Automation

`[CHANGED]` Resend handles transactional mail. Zoho Flow integration deferred.

On submission:
- `[DONE]` Score computed, pass flag set, status → submitted
- ⏳ Send confirmation email — deferred
- ⏳ Tag candidate in CRM — deferred
- ⏳ Notify internal team — partially via Zoho archive summary email
- ⏳ Add to pipeline — deferred

Conditional automation (high/low score → next stage) deferred.

---

## Edge Cases & Risks

- Large audio/file uploads — `[DONE]` 5-minute voice cap, Supabase signed PUT for direct browser upload
- Network failure — `[DONE]` candidate refresh resumes; `[ADDED]` per-question retry built in for AI scoring
- Candidate drop-off — `[DONE]` one-question UX, sticky progress bar
- Confusion on negative marking — communicated on intake page
- Mobile performance — `[DONE]` mobile-first, tested on iOS Safari + iOS Chrome
- Poor network → timer mismatch — server-truth `last_question_shown_at` reconciles
- Mobile latency — page renders only the current question; payload minimal
- Voice responses cut off — 5-minute MediaRecorder cap with auto-stop
- User confusion — clear copy on the intake screen + per-question hints
- `[ADDED]` AI model deprecation — friendly error humanisation surfaces "model not available" plainly; rotation to a new model is a one-line change in `lib/ai/gemini.ts` / `lib/ai/kimi.ts`
- `[ADDED]` Kimi flake — retry-with-backoff on transient 404/429/5xx
- `[ADDED]` PKCE mismatch on invite emails — solved via `token_hash` flow in Supabase templates

---

## Additional Instructions

- Prioritise simplicity and scalability
- Optimise for mobile-first experience
- Default to multiple-choice efficiency
- Ensure all other response types are easy to review
- `[ADDED]` AI features must always have a human override path and clear attribution
- `[ADDED]` Never auto-block a candidate on a soft signal — always surface to a reviewer

---

## Final Goal

This is not just an assessment tool.

It is a:
- Talent filtering system
- Talent discovery engine
- Data intelligence layer
- Pipeline builder for solar workforce

`[ADDED]` And an AI-augmented reviewer cockpit — where humans stay in the loop, AI surfaces signal, and audit trails capture every decision.

It should feel modern, intelligent, and aligned with positioning solar careers as high-value and future-facing.
