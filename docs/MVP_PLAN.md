# MVP Implementation Plan

## Phases

### Phase 0 — Foundations (done in this build)
- Repo structure, architecture docs, schema, Jotform form created in the live
  account (`261617924502052`).

### Phase 1 — MVP (built here)
Backend:
- [x] Auth (email/password, JWT), RBAC middleware
- [x] User management (add/edit/deactivate/roles/cardholder info)
- [x] AMEX CSV import with dedup + audit logging
- [x] Transactions API with role-scoped visibility, status lifecycle,
      assignment, ignore, archive, undo
- [x] Receipt submission (image upload, fields, optional charge link),
      authenticated image serving
- [x] Jotform service: dynamic field map, forward submissions, poll/sync inbound
      submissions (needs `JOTFORM_API_KEY` at runtime)
- [x] Matching engine with score breakdown; suggest-only by default
- [x] Reminder engine: configurable schedule, signed action links
      (upload / reassign / note / not-mine), escalation to admin,
      stop-on-resolution, dedup, channel abstraction for future SMS
- [x] Audit logs on all mutations
- [x] Seed script + sample AMEX CSV + automated tests

Mobile (Expo):
- [x] Login, Home, Submit Receipt (camera/library), Outstanding Charges,
      Charge Detail, My Receipts, Admin Dashboard, User Management, Settings
- [ ] On-device QA on physical iPhone/Android (requires running `expo start`
      with the backend reachable — first thing to do on a dev machine)

### Phase 2 — Pilot hardening
- Deploy backend (Render/Fly/Railway) + Postgres + S3 for images
- Real SMTP account; tune templates with finance team
- Jotform webhook (instant inbound sync) replacing/augmenting polling
- EAS builds + internal distribution (TestFlight / Play internal track)
- Password reset + optional magic-link login

### Phase 3 — Automation
- Aggregator (Plaid/Finicity) AMEX sync — verify business-card coverage first
- Optional auto-match rules (admin-enabled, threshold-based)
- Push notifications; SMS reminders (Twilio) — schema already supports both
- Email-reply parsing only if the signed-link flow proves insufficient

## Matching score (engine: `backend/src/services/matching.js`)

| Signal | Points |
|---|---|
| Exact amount | 40 (within $1: 25) |
| Date delta 0 days | 20 · 1–2 days: 15 · 3–5 days: 8 |
| Merchant similarity (normalized token overlap / containment) | up to 20 |
| Submitter is cardholder or assignee of the charge | 15 |
| Receipt submitted within 7 days of transaction | 5 |
| Prefilled charge ID from email deep-link | forces 95+ |

Suggested match: score ≥ 55 → transaction flagged `likely`.
Confirmation always manual unless admin enables auto-match
(`auto_match_enabled`, default off, threshold default 90).

## Edge cases addressed (spec §16 → where handled)
- Duplicate AMEX imports → `import_hash` UNIQUE (csvImport)
- Duplicate receipts / same image twice → `jotform_submission_id` UNIQUE +
  `image_sha256` warning surfaced to admin
- Same amount & date confusion → matcher returns *all* candidates with
  breakdowns; admin sees competing candidates before confirming
- Pending vs posted duplicates → content-hash dedup + matcher surfaces near-dupes
- Jotform form edits → dynamic field map + raw payload retention + admin alert
  on unmappable required fields
- Photo lost before submit → image uploads with the submission in one request;
  failures return an explicit error and the app keeps local state for retry
- Unauthorized visibility → SQL-level role scoping, tested
- Archived ≠ deleted → status change only; archive list endpoint; undo restores
- Reminders after match/reassignment → engine re-resolves recipient and stops on
  matched/ignored/archived, every cycle; tested
- Assigning to inactive user → rejected with 400, tested
- Timezones → calendar-date strings, no Date-object day math
- Currency → integer cents everywhere, tested
- Silent failures → import/run errors recorded in audit_logs; Jotform forward
  has pending/failed status + retry
- Secrets → env vars only
- Camera permission denied → app falls back to library picker with guidance
- Slow networks → client timeouts + visible failure states, no fire-and-forget
- Missing required fields → validated server-side (400) and client-side
