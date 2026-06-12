# Technical Architecture

## Stack decision

| Layer | Choice | Why |
|---|---|---|
| Mobile app | **Expo (React Native)** | One codebase for iOS + Android; first-class camera/image-picker APIs; Expo Go makes internal distribution trivial for a small staff; EAS Build produces store-ready binaries later. |
| Backend | **Node.js / Express** | The product is mostly *server-side workflows* (matching engine, reminder scheduler, Jotform sync, CSV import). A plain Node service keeps those jobs, the API, and the cron loop in one deployable unit. |
| Database | **SQLite for MVP → PostgreSQL for production** | SQLite makes the MVP runnable anywhere with zero provisioning. All SQL is written in the common subset; `backend/src/db.js` is the only file that touches the driver, so swapping to Postgres (or Supabase) is a one-file change plus a connection string. |
| Auth | Email + password, bcrypt-hashed, JWT sessions | Simple, self-contained, no third-party dependency. Magic-link login can be added later (the mailer infrastructure already exists). |
| File storage | Local `uploads/` dir for MVP → S3/Supabase Storage later | Receipt images are **never** served from public URLs; they are streamed through an authenticated endpoint that enforces RBAC. The storage layer is isolated in the receipts route so a cloud bucket + signed URLs is a drop-in change. |
| Email | Nodemailer over SMTP (any provider: Google Workspace, SES, Postmark) | If SMTP is unconfigured the mailer logs the message and records the reminder as `simulated`, so the whole workflow is testable without credentials. |

### Why not Firebase/Supabase outright?

Both are fine targets and the schema ports directly. But the core of this product is
custom server logic (scoring matcher, escalating reminder rules, Jotform polling,
CSV dedup). With BaaS you end up writing all of that in cloud functions anyway, while
losing easy local runnability. Recommendation: deploy this Node service to Render /
Fly.io / Railway with managed Postgres, or adopt Supabase in Phase 2 for
auth + storage while keeping this service for the workflow engine.

## System diagram

```
┌─────────────┐     HTTPS/JWT      ┌──────────────────────────────┐
│  Expo app    │ ◄────────────────► │  Node/Express API            │
│ (iOS/Android)│                    │                              │
└─────────────┘                    │  ├─ Auth + RBAC middleware    │
                                   │  ├─ Users / Transactions /    │
┌─────────────┐  email w/ secure   │  │  Receipts / Matches routes │
│ Staff inbox  │ ◄───links──────── │  ├─ Matching engine           │
└─────────────┘                    │  ├─ Reminder engine (cron)    │
                                   │  ├─ CSV importer (AMEX)       │
┌─────────────┐   REST (API key)   │  └─ Jotform sync service      │
│   Jotform    │ ◄────────────────► │                              │
│ form 2616…052│                    └──────────┬───────────────────┘
└─────────────┘                               │
                                   ┌──────────▼───────────┐
                                   │ SQLite / PostgreSQL  │
                                   │ + uploads/ (images)  │
                                   └──────────────────────┘
```

## Components

### API server (`backend/src/server.js`)
Express app, JSON API under `/api/*`. Every route behind JWT auth except
`/api/auth/login` and the tokenized email-action endpoints. RBAC middleware:
`admin` > `level1` (cardholder) > `level2` (assigned user). Users only ever
receive rows they are authorized to see — filtering happens in SQL, not the client.

### Matching engine (`backend/src/services/matching.js`)
Pure-function scorer (unit tested) + orchestration that runs after every receipt
submission and every transaction import. Produces `likely` matches above a
threshold; never auto-confirms (admin confirmation required unless an admin
enables the auto-match setting). See scoring table in `docs/MVP_PLAN.md`.

### Reminder engine (`backend/src/services/reminders.js`)
Cron loop (hourly). For each `outstanding`/`likely` transaction, determines the
responsible user (assigned user wins over cardholder), checks the configurable
schedule (initial / +2d / +5d / escalate +7d / periodic), and sends email with a
**signed action link** (HMAC token) that lets the recipient upload a receipt,
reassign the charge, add a note, or mark "not mine" — no email-reply parsing.
Reminders stop the moment a charge leaves outstanding status; reassignment
redirects future reminders to the new user. Every send is recorded in
`reminders` (dedup-checked) and the engine is channel-abstracted
(`channel: email | sms | push`) so SMS can be added without schema changes.

### Jotform sync (`backend/src/services/jotform.js`)
See `docs/JOTFORM_INTEGRATION.md`. Field discovery is dynamic; submissions are
pulled by polling (webhook optional later) and deduped on `jotform_submission_id`.

### CSV importer (`backend/src/services/csvImport.js`)
See `docs/AMEX_INTEGRATION.md`. Header auto-detection, amount/date normalization,
dedup on external ID or content hash, import runs logged to `audit_logs`.

### Audit log
All mutating actions (user edits, imports, match confirm/undo, archive,
reassignment, settings changes) write an `audit_logs` row with actor, entity,
and metadata JSON.

## Security model

- Passwords bcrypt-hashed; JWTs short-lived (24h) signed with `JWT_SECRET` env var.
- **No AMEX credentials anywhere** — MVP ingests CSV exports only; a future
  aggregator (Plaid/Finicity) keeps bank credentials with the aggregator, never us.
- Jotform API key, SMTP creds, JWT secret: environment variables only
  (`.env` is gitignored; `.env.example` documents the shape).
- Receipt images served only via `GET /api/receipts/:id/image` with JWT + RBAC
  check (owner, assignee, or admin). No static/public file hosting.
- Email action links are HMAC-signed, single-purpose, scoped to one transaction,
  and expire (default 30 days).
- Role-based row filtering in every list query; level1 sees own card's charges,
  level2 sees only charges assigned to them, admin sees all.
- Audit trail on all manual changes.

## Deployment recommendation

MVP: single small VM/container (Render, Fly.io, Railway) + managed Postgres +
S3-compatible bucket. Point the Expo app's `API_BASE_URL` at it. Distribute the
app via Expo internal distribution (no app-store review needed for internal use),
moving to TestFlight/Play internal track when convenient.
