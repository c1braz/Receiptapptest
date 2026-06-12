# Assumptions, Blockers, and Security Concerns

(Per spec §18: identified before coding.)

## Assumptions made
1. **Org context** — the Jotform account contents (camps, theatre, ceramics,
   visual art) indicate an arts-education nonprofit; the "wine items" field is
   assumed to relate to fundraising/event purchases. Category and item options
   on the created form are sensible defaults — edit freely in Jotform; the app
   adapts dynamically.
2. **Scale** — tens of users, hundreds of transactions/month. SQLite + a single
   small server is ample for a pilot; Postgres recommended for production.
3. **Single currency (USD)** and a single AMEX business account (multiple cards
   under it, distinguished by cardholder name / last-four).
4. **Email is deliverable** via an SMTP account the org already has (Google
   Workspace works). Until configured, reminders run in "simulated" mode.
5. **Internal distribution** is acceptable initially (Expo Go / internal
   builds); app-store publication is not an MVP requirement.
6. Receipts may arrive **before** their charge (CSV imports are periodic), so
   matching re-runs on both receipt creation and transaction import.

## Blockers / needs-from-you
1. **Jotform API key** — create at jotform.com → Settings → API (Full Access),
   set `JOTFORM_API_KEY` in `backend/.env`. Without it, in-app receipts still
   work (stored in our DB, queued for forward); inbound Jotform sync waits.
2. **SMTP credentials** for reminder emails (`SMTP_HOST/PORT/USER/PASS/FROM`).
3. **A real AMEX CSV export** — the importer auto-detects the standard AMEX
   headers, but confirm against your account's actual export once.
4. **Aggregator decision (Phase 3)** — Plaid/Finicity business-card coverage
   for your specific AMEX account must be trialed before promising auto-sync.
5. **Hosting** — pick Render/Fly/Railway (or org server) for the backend before
   staff onboarding; the mobile app needs a stable HTTPS base URL.

## Security concerns and mitigations
| Concern | Mitigation |
|---|---|
| AMEX credentials | Never collected or stored. CSV now; OAuth-via-aggregator later. |
| Receipt images are financial PII | Served only through an authenticated, role-checked endpoint; no public URLs. Move to S3 + short-lived signed URLs in production. |
| Email links could be forged/replayed | HMAC-signed tokens, single transaction scope, expiry, consumption recorded. |
| Jotform API key leakage | Server-side env var only; never sent to the mobile client. |
| Privilege escalation | RBAC enforced in SQL row filters and route middleware; admin-only routes explicitly gated; tested. |
| No accountability for manual changes | `audit_logs` on every mutation incl. settings changes, imports, match confirm/undo. |
| Note: Jotform hosted form | Anything submitted via the public form URL lives in Jotform too — Jotform account security (2FA, limited shared logins) is part of the threat model. The link-token only prefills a charge reference, never exposes other data. |

## Known limitations of this first build
- Mobile app written and lint/parse-checked but **not yet exercised on a
  device/simulator** — that's the first task on a dev machine with Xcode/
  Android Studio or Expo Go.
- Password reset flow is a stub (admin can reset a user's password); magic-link
  login deferred to Phase 2.
- Jotform "edit in place" coverage is dynamic-mapped but should be smoke-tested
  once after any major form restructuring.
