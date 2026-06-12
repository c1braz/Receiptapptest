# AMEX Integration Plan

## Reality check on direct AMEX access

- American Express does **not** offer a self-serve transactions API for business
  card customers; "Amex for Developers" APIs are partner-gated.
- US data aggregators (Plaid, Finicity/Mastercard, MX) connect to Amex via
  OAuth-based account linking. Coverage for **business** card accounts varies by
  account type and must be verified against the org's actual account before
  committing — this requires a live trial with the org's credentials, which is a
  Phase 2 task.
- Therefore the MVP ships with **CSV import**, which AMEX business accounts
  support today (Statements & Activity → Download → CSV/Excel), and the
  architecture isolates ingestion behind one interface so an aggregator can be
  added without touching the rest of the system.

## Verified against a real export (2026-06-11)

The org's actual activity export (`Date,Receipt,Description,Card Member,
Account #,Amount`) was imported 29/29 with correct cardholder attribution.
Quirks the importer now explicitly handles:

- **Double-spaced card member names** (`BRIAN  GAMEL`) — names are compared
  with collapsed whitespace.
- **No reference column** in activity exports — dedup uses a content hash,
  with an occurrence suffix so two genuinely identical same-day charges
  (common with Amazon) both import while re-imports still dedup fully.
- **5-digit account codes** (`-12016`) — last four digits are stored
  (`2016`); enter that value as the user's "card last four".
- **Quoted commas** in merchant names (`"CHECKR, INC …"`).
- The `Receipt` column (`*` = receipt attached inside AMEX) is currently
  ignored; it could later pre-mark charges as documented in AMEX.

## Phase 1 (shipped in MVP): CSV import

- Admin Settings → AMEX Import → upload CSV (or `POST /api/transactions/import`).
- The importer auto-detects AMEX export headers (`Date`, `Description`,
  `Card Member`, `Account #`, `Amount`, and the extended-detail variant) and also
  accepts a generic header set, so a re-formatted export still works.
- Normalization: dates parsed as **calendar dates** (no timezone math — a charge
  on the 5th stays on the 5th), amounts parsed to integer **cents** (no float
  drift), credits/payments (negative amounts) skipped by default.
- **Dedup:** if the file has a reference/transaction ID, that is the unique key;
  otherwise a content hash of `date|amount|merchant|last4` is used. Re-importing
  an overlapping CSV is safe and reports `imported` vs `skipped_duplicates`.
  Pending-then-posted duplicates collapse onto the same hash once the posted row
  matches; near-duplicates (same amount/merchant, date shifted by posting) are
  surfaced by the matcher rather than silently merged.
- Cardholder attribution: `Card Member` name and/or card last-four are matched
  against `users.cardholder_name` / `users.card_last_four`; unmatched rows import
  as unassigned and appear in the admin dashboard for manual assignment.
- Every import run is recorded in `audit_logs` (row counts, errors, actor), so
  failed imports are never silent.

## Phase 2: aggregator sync (Plaid or Finicity/MX)

- Add `backend/src/services/aggregatorImport.js` implementing the same
  `normalizeAndUpsert(transactions)` entry point the CSV importer uses.
- Link flow: admin opens Plaid Link (or equivalent) from Admin Settings; the
  backend stores only the aggregator **access token** (encrypted at rest), never
  AMEX credentials. AMEX login happens on AMEX's own OAuth page.
- Webhook-driven incremental sync; the same dedup keys apply, so a CSV backfill
  plus aggregator sync won't double-import.
- `transactions.external_transaction_id` and `import_source` columns already
  exist to support this.

## Explicitly rejected for now

- **Storing AMEX usernames/passwords** — never.
- **Screen-scraping AMEX online banking** — fragile, likely violates terms.
- **Email parsing of AMEX alerts** — possible future fallback for *instant*
  charge notifications (the data model supports it: an alert would just create a
  `pending` transaction), but not in MVP per spec.

## Charge data stored

`transactions`: external transaction ID (nullable), cardholder user, assigned
user (nullable), merchant, amount (cents), transaction date, posted date
(nullable), card last-four, status (`outstanding | likely | matched | archived |
ignored`), match confidence, matched receipt, import source + content hash,
archived timestamp. See `docs/DATA_MODEL.md`.
