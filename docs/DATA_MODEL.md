# Data Model

Authoritative DDL lives in `backend/src/db.js` (applied automatically on boot).
SQLite for MVP; every type/constraint used is Postgres-compatible.

Amounts are stored as **integer cents** everywhere (no floating point).
Transaction dates are stored as `YYYY-MM-DD` strings (calendar dates, no TZ).
Timestamps are ISO-8601 UTC.

## users
| column | type | notes |
|---|---|---|
| id | integer PK | |
| name | text NOT NULL | |
| email | text NOT NULL UNIQUE | login + reminder address, lowercased |
| phone | text | stored now for future SMS |
| password_hash | text | bcrypt |
| role | text | `admin` \| `level1` \| `level2` |
| active | integer (bool) | deactivated users can't log in or be assigned |
| cardholder_name | text | as it appears in AMEX exports (level1) |
| card_last_four | text | |
| notification_prefs | text JSON | `{"email":true,"sms":false,"push":false}` |
| created_at / updated_at | text | |

## transactions
| column | type | notes |
|---|---|---|
| id | integer PK | |
| external_transaction_id | text | AMEX reference if present in CSV |
| import_hash | text UNIQUE | dedup key (external ID or content hash) |
| import_source | text | `csv` \| `aggregator` \| `manual` |
| cardholder_user_id | FK users | nullable (unattributed imports) |
| assigned_user_id | FK users | set when a level1 lends the card |
| merchant_name | text | |
| amount_cents | integer | |
| transaction_date | text `YYYY-MM-DD` | |
| posted_date | text | nullable |
| card_last_four | text | |
| status | text | `outstanding` \| `likely` \| `matched` \| `archived` \| `ignored` |
| match_confidence | integer | 0–100, best current candidate |
| matched_receipt_id | FK receipts | set on confirm |
| archived_at | text | archived rows remain queryable forever |
| created_at / updated_at | text | |

## receipts
| column | type | notes |
|---|---|---|
| id | integer PK | |
| submitted_by_user_id | FK users | |
| jotform_submission_id | text UNIQUE | dedup key for Jotform sync |
| jotform_status | text | `none` \| `pending` \| `forwarded` \| `failed` (retry queue) |
| merchant_name | text | |
| amount_cents | integer | |
| transaction_date | text | |
| category | text | |
| line_items | text JSON | wine items / class items selections |
| image_path | text | local path (S3 key later); served only via authed endpoint |
| image_sha256 | text | duplicate-image detection |
| notes | text | |
| raw_payload | text JSON | full Jotform submission, survives form edits |
| created_at / updated_at | text | |

## matches
| column | type | notes |
|---|---|---|
| id | integer PK | |
| transaction_id | FK | |
| receipt_id | FK | |
| confidence_score | integer | 0–100 |
| score_breakdown | text JSON | per-signal points, shown to admin |
| status | text | `suggested` \| `confirmed` \| `rejected` \| `undone` |
| confirmed_by_user_id | FK users | |
| confirmed_at | text | |
| created_at | text | |
| | | UNIQUE(transaction_id, receipt_id) |

## reminders
| column | type | notes |
|---|---|---|
| id | integer PK | |
| transaction_id | FK | |
| user_id | FK | recipient at send time |
| reminder_type | text | `initial` \| `day2` \| `day5` \| `escalation` \| `periodic` |
| channel | text | `email` now; `sms` / `push` later |
| sent_at | text | |
| status | text | `sent` \| `simulated` \| `failed` |
| | | UNIQUE(transaction_id, user_id, reminder_type) — no duplicate sends |

## audit_logs
| column | type | notes |
|---|---|---|
| id | integer PK | |
| user_id | FK users | nullable (system actions) |
| action | text | e.g. `csv_import`, `match_confirmed`, `match_undone`, `charge_reassigned`, `user_deactivated`, `settings_changed` |
| entity_type / entity_id | text / integer | |
| timestamp | text | |
| metadata | text JSON | |

## app_settings
Key/value (JSON values): `jotform_api_key`*, `jotform_form_id`,
`jotform_field_map`, `reminder_schedule` (`{initial:0, second:2, third:5,
escalate:7, periodic:7}` days — admin-editable), `auto_match_enabled` (default
false), `auto_match_threshold`, email templates.

*Stored server-side only; in production move to a secrets manager — never in the
mobile app or client responses.

## action_tokens
HMAC-signed single-purpose tokens backing the secure email links
(upload / reassign / note / not-mine), scoped to one transaction + user with
expiry. Tokens are verifiable statelessly; the table records issuance and
consumption for audit.
