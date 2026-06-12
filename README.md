# AMEX Receipt Intake & Reconciliation App

Internal tool for collecting staff purchase receipts, matching them to AMEX business
card charges, and tracking charges that are still missing documentation.

## What's in this repo

| Path | What it is |
|---|---|
| `docs/` | Architecture, data model, integration plans, user flows, MVP plan, assumptions |
| `backend/` | Node/Express API + SQLite database (Postgres-portable), matching engine, reminder engine, Jotform sync, CSV import |
| `mobile/` | Expo (React Native) app for iOS + Android |
| `backend/sample-data/` | Sample AMEX CSV export for testing import |

## Live Jotform form

A receipt intake form has been created in the org's Jotform account:

- **Form ID:** `261617924502052`
- **URL:** https://form.jotform.com/261617924502052
- Editable in Jotform; the app discovers fields dynamically via the Jotform API
  (see `docs/JOTFORM_INTEGRATION.md`), so renaming/reordering fields will not break the app.

## Quick start (backend)

```bash
cd backend
npm install
cp .env.example .env       # fill in JWT secret, Jotform API key, SMTP creds
npm run seed               # creates demo admin + users + imports sample AMEX CSV
npm start                  # API on http://localhost:4000
npm test                   # smoke + unit tests
```

Default seeded admin: `admin@example.org` / `ChangeMe123!` (change immediately).

## Quick start (mobile)

```bash
cd mobile
npm install
npx expo start             # scan QR with Expo Go on iPhone/Android
```

Set the API base URL in `mobile/src/api/client.js` (defaults to `http://localhost:4000`
which works in the iOS simulator; use your machine's LAN IP for a physical device).

## MVP status

See `docs/MVP_PLAN.md` for the phase breakdown and what is implemented vs. planned.
