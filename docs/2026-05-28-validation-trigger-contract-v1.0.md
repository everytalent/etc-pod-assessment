# Validation Trigger + Result Read Contract — v1.0

**Date:** 2026-05-28
**Status:** Draft — Assessment Engine to implement endpoints 1, 2; podsproject to implement endpoint 3 (consumer) + outbound call to endpoint 1.
**Sequels:** v1.1 amendment (2026-05-26) covered the existing `GET /candidates/:id/profile` (Assessment reads from Onboarding). This contract adds the reverse and result flows.

## Topology

```
┌─────────────────────────────┐                  ┌──────────────────────────────────────┐
│  podsproject (Railway)      │                  │  Assessment Engine (Netlify)         │
│                             │                  │                                       │
│  Onboarding flow            │  ── POST ─────►  │  /api/internal/sessions       (NEW) │
│  Talent profile page        │  ── GET ─────►   │  /api/internal/candidates/:id/        │
│                             │                  │     vetted-profiles           (NEW) │
│  Validation completed       │  ◄── POST ──     │  (after candidate finishes)         │
│     popup (existing)        │                  │                                       │
│                             │                  │  /api/internal/candidates/:id/        │
│                             │  ◄── GET ──      │     profile          (already v1.1)  │
└─────────────────────────────┘                  └──────────────────────────────────────┘
```

All endpoints share the same `ETC_ASSESSMENT_SERVICE_TOKEN` Bearer auth that v1.1 already established. No new secrets.

---

## Endpoint 1 — `POST /api/internal/sessions` (Assessment Engine implements)

Onboarding calls this to mint a validation session for a candidate.

### When Onboarding should call

Recommended triggers (Onboarding's call):
- Candidate clicks a "Start your competency validation" CTA on their dashboard
- Backend decision: profile completion + specs claimed → validate
- Admin-initiated invite

**Idempotency:** safe to retry on 5xx/timeout with the same body. Assessment dedupes by `(candidate_id, sorted(specialisations))` within a 60-second window. Calling again for the same `(candidate, spec)` while a session is `pending` or `in_progress` returns 409 with the existing session URL.

### Request

```http
POST /api/internal/sessions HTTP/1.1
Host: assess.energytalentco.com
Authorization: Bearer <ETC_ASSESSMENT_SERVICE_TOKEN>
Content-Type: application/json

{
  "candidate_id": "ETC-00145",
  "specialisations": ["System Design"],
  "redirect_url_after_completion": "https://app.energytalentco.com/candidate/profile",
  "expires_in_days": 7
}
```

#### Field semantics

| Field | Required | Type / constraint | Notes |
|---|---|---|---|
| `candidate_id` | yes | string, must match an existing candidate on Onboarding side | Assessment will fetch the profile via the v1.1 endpoint to bootstrap claimed band, work history, etc. |
| `specialisations` | yes | array of strings, 1-4 entries, max 120 chars each | Must match an *activated* skillboard's `specialisation` field (case-sensitive). Returns 422 `unknown_specialisation` otherwise. |
| `redirect_url_after_completion` | optional | URL, max 500 chars | Where the candidate's browser navigates after they finish. Defaults to `${ONBOARDING_API_URL}/candidate/profile`. |
| `expires_in_days` | optional | integer, 1-30 | Token lifetime. Default 7. |

### Responses

#### 201 Created — happy path

```json
{
  "session_id": "01943c1a-9876-7c2a-aaaa-bbbbccccdddd",
  "token": "vk_7xq3p1m8a2yfw9c4...",
  "url": "https://assess.energytalentco.com/take/vk_7xq3p1m8a2yfw9c4...",
  "expires_at": "2026-06-04T13:45:00.000Z",
  "specialisations_resolved": ["System Design"]
}
```

Onboarding shows `url` to the candidate (button, dashboard CTA, redirect, or in an email — your call).

#### 409 Conflict — session already open

```json
{
  "error": "session_already_open",
  "message": "A pending validation session already exists for this candidate × spec.",
  "existing_session": {
    "session_id": "...",
    "token": "...",
    "url": "https://assess.energytalentco.com/take/...",
    "expires_at": "..."
  }
}
```

**Action:** show the candidate `existing_session.url`. Don't retry.

#### 422 Unprocessable Entity — invalid input

Possible `error` codes:
- `unknown_specialisation` — at least one spec doesn't match any skillboard. Body includes `unknown: ["spec1", "spec2"]`.
- `skillboard_not_activated` — spec exists but the board hasn't been activated yet (no approved cells, no Validation Bank assessment). Body includes `inactive: ["spec1"]`.
- `validation_bank_empty` — skillboard is activated but its `Validation Bank — <spec>` assessment has zero approved questions. Body includes `empty_banks: ["spec1"]`.
- `too_many_specialisations` — array > 4 entries.

**Action:** show the candidate a fallback message ("validation not yet available for these specs"). Do not retry.

#### 404 Not Found

```json
{ "error": "candidate_not_found", "message": "Onboarding has no profile for this candidate_id." }
```

Assessment hit the v1.1 endpoint and got 404 back. **Action:** ensure the candidate exists on Onboarding side first.

#### 401 Unauthorized

Bearer token missing or wrong. Check the env var on Onboarding side matches `ETC_ASSESSMENT_SERVICE_TOKEN` on Assessment side.

#### 5xx — retryable

Use exponential backoff: 1s, 2s, 4s, 8s, give up after 4 tries. Body shape is best-effort `{ "error": "internal", "message": "..." }`.

---

## Endpoint 2 — `GET /api/internal/candidates/:candidate_id/vetted-profiles` (Assessment Engine implements)

Talent profile page (built by podsproject per the master spec) calls this to render the candidate's vetted results across every spec they've been validated for.

### Design choice: pull, not push

Assessment is the source of truth for vetted profiles. Admins can override band, level, mindset, qualified scopes, and reservation flags **at any time** (including after the candidate is "done"). A pushed snapshot would drift; a pull always shows current state.

### Request

```http
GET /api/internal/candidates/ETC-00145/vetted-profiles HTTP/1.1
Host: assess.energytalentco.com
Authorization: Bearer <ETC_ASSESSMENT_SERVICE_TOKEN>
```

### Response — 200 OK

```json
{
  "candidate_id": "ETC-00145",
  "profiles": [
    {
      "specialisation": "System Design",
      "validated_at": "2026-05-28T14:12:33.412Z",
      "claimed_band": "junior",
      "final_band": "mid",
      "final_level": "g",
      "display_label": "Growing Mid-Level",
      "cadre": "int",
      "confidence": 78,
      "hire_recommendation": "hire",
      "requires_human_review": false,
      "per_skill_breakdown": [
        {
          "skill_id": "...",
          "skill_name": "PVsyst Modelling",
          "level": "p",
          "evidence_count": 4
        }
      ],
      "mindset_profile": [
        { "mindset": "Diagnostic curiosity", "strength": "strong" },
        { "mindset": "Standards rigour", "strength": "emerging" }
      ],
      "qualified_scopes": [
        "Residential systems up to 10 kWp",
        "C&I rooftop up to 100 kWp"
      ],
      "reservation_flags": [
        { "flag": "Limited grid-tied design exposure", "severity": "warn" }
      ],
      "rationale": "Strong on residential design fundamentals…",
      "final_source": "ai"
    }
  ]
}
```

### Field reference

| Field | Type | Notes |
|---|---|---|
| `specialisation` | string | Maps to a skillboard |
| `validated_at` | ISO-8601 | When the synthesis ran (NOT when the candidate finished — overrides may have updated this) |
| `claimed_band` | enum (junior/mid/senior) | What the candidate claimed via Onboarding |
| `final_band` | enum (junior/mid/senior) | What the validation produced |
| `final_level` | enum (below/nh/g/p/tp) | Performance level within the band |
| `display_label` | string | Human-readable combination of band+level. Use as-is in UI. |
| `cadre` | enum (el/int/expd/adv/expt) | Learner-facing label (entry/intermediate/experienced/advanced/expert) — use this for the popup |
| `confidence` | integer 0-100 | Overall confidence score |
| `hire_recommendation` | enum | `hire` / `no_hire` / `borderline` / `requires_human_review` |
| `requires_human_review` | boolean | First 90 days mandate flag |
| `per_skill_breakdown` | array | Per-skill performance level. Each row has `skill_id`, `skill_name`, `level`, and an `evidence_count` (how many questions contributed) |
| `mindset_profile` | array | `mindset` (string name) + `strength` (`strong` / `emerging` / `not_observed`) |
| `qualified_scopes` | string[] | Explicit project scopes the candidate is qualified for |
| `reservation_flags` | array | Concerns. Each has `flag` (text) + `severity` (`info` / `warn` / `critical`) |
| `rationale` | string | 1-3 paragraph narrative explaining the assessment |
| `final_source` | enum | `ai` (synthesis only) or `human_override` (admin touched any field) |

### Empty / partial responses

- Candidate exists but has never been validated → `{ "candidate_id": "...", "profiles": [] }` with 200.
- Candidate has validated some specs and not others → only validated specs appear in `profiles`.
- Validation is in progress → that spec is omitted until synthesis completes.

### 404 Not Found

```json
{ "error": "candidate_not_found", "message": "Assessment has no record of this candidate." }
```

Happens when the candidate has never had a session created on Assessment side (Onboarding never called endpoint 1 for them).

### Optional history

Default behaviour returns only the LATEST profile per spec. To get full history (every version including pre-override states):

```
GET /api/internal/candidates/:id/vetted-profiles?include_history=true
```

Each spec then has a `history` array under it, oldest first. **The talent profile page does not need this** — it's for audit consumers only.

### Caching guidance

- Safe to cache for 30s on the consumer side (profile page render).
- Do NOT cache longer than that — overrides can land at any time and you'd show stale data.
- We don't return ETags yet. If you need them later, raise it and we'll add.

---

## Endpoint 3 — `POST {ONBOARDING_API_URL}/api/internal/validations/completed` (podsproject implements)

Assessment calls this when a candidate finishes their validation **and** synthesis completes. Used to fire the "you completed validation" popup on the Onboarding dashboard. The full profile is fetched separately via endpoint 2.

### Request

```http
POST /api/internal/validations/completed HTTP/1.1
Host: etc-os-api-production.up.railway.app
Authorization: Bearer <ETC_ASSESSMENT_SERVICE_TOKEN>
Content-Type: application/json

{
  "candidate_id": "ETC-00145",
  "session_id": "01943c1a-...",
  "completed_at": "2026-05-28T14:12:33.412Z",
  "per_spec_summary": [
    {
      "specialisation": "System Design",
      "cadre": "int",
      "display_label": "Intermediate"
    }
  ],
  "result_url": "https://app.energytalentco.com/candidate/profile"
}
```

The body is intentionally minimal — just enough to populate the popup. For full breakdown, the popup CTA navigates to the talent profile page, which renders from endpoint 2.

### Response expected from podsproject

- **2xx** = received, popup will fire. Body content ignored.
- **4xx or 5xx** = Assessment retries with exponential backoff (1s, 2s, 4s, 8s, 16s, 32s, give up after 6 attempts; ~1 minute total).
- **Timeout** (> 10s) = retried as 5xx.

If you can't process the call right now (e.g. brief downtime), return 503 and Assessment will retry. If the candidate's data is unparseable for some reason, return 4xx and we won't retry.

### Idempotency

We send `session_id` so podsproject can dedupe if a retry succeeds after the first one already landed.

---

## Auth — shared with v1.1

Same `ETC_ASSESSMENT_SERVICE_TOKEN` value as the v1.1 contract uses. No new secrets to coordinate. If the token is ever rotated:

1. Assessment side env (`ETC_ASSESSMENT_SERVICE_TOKEN`)
2. Onboarding side env (whatever name Victory's side uses — most likely the same name or `ASSESSMENT_SERVICE_TOKEN`)
3. Rotate both at the same time during a maintenance window

---

## What each side needs to do

### Assessment Engine (Ugo)

- [ ] Build `POST /api/internal/sessions` route
  - Auth check (Bearer header match)
  - Profile bootstrap via existing `getOnboardingProfile()`
  - Specialisation validation (skillboard exists + active + bank non-empty)
  - Dedupe window for idempotency
  - Token generation + `responses` row creation + claimed_band stored
  - 409 with existing session URL on conflict
- [ ] Build `GET /api/internal/candidates/:id/vetted-profiles` route
  - Auth check
  - Read from `vetted_talent_profile` + apply overrides
  - Shape per the spec above
  - `?include_history=true` opt-in
- [ ] Build `/take/[token]` candidate landing page
  - Resolve token → response → spec list
  - Render spec-selection if multi-spec (per PRD §4)
  - Kick off first CAT question
- [ ] Build outbound `POST {ONBOARDING_API_URL}/api/internal/validations/completed`
  - Fires from the synthesis completion path
  - Retry with backoff
  - Dead-letter to `notify_log` if all retries exhausted

### podsproject (Victory / Ugo)

- [ ] Add `ASSESS_API_URL` env (if not already)
- [ ] Confirm `ASSESS_SERVICE_TOKEN` env value matches Assessment's `ETC_ASSESSMENT_SERVICE_TOKEN`
- [ ] Write `requestValidationSession(candidate_id, specialisations[])` that POSTs to endpoint 1
- [ ] Wire that function to chosen trigger (button click / auto-fire)
- [ ] Build `POST /api/internal/validations/completed` route on Onboarding side that fires the popup
- [ ] Talent profile page calls endpoint 2 on render
- [ ] Update master spec doc to reference this contract

---

## Versioning

Breaking changes (renamed fields, removed fields, changed enums) require a v2.0 shipped under a new path: `/api/internal/v2/sessions` and `/api/internal/v2/candidates/:id/vetted-profiles`.

Additive changes (new optional fields, new enum values) ship under v1.x amendments — same pattern as the v1.1 amendment for `years_bucket`.
