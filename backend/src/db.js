const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { now } = require('./lib');

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','level1','level2')),
  active INTEGER NOT NULL DEFAULT 1,
  cardholder_name TEXT,
  card_last_four TEXT,
  notification_prefs TEXT NOT NULL DEFAULT '{"email":true,"sms":false,"push":false}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_transaction_id TEXT,
  import_hash TEXT UNIQUE,
  import_source TEXT NOT NULL DEFAULT 'csv',
  cardholder_user_id INTEGER REFERENCES users(id),
  assigned_user_id INTEGER REFERENCES users(id),
  merchant_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  transaction_date TEXT NOT NULL,
  posted_date TEXT,
  card_last_four TEXT,
  status TEXT NOT NULL DEFAULT 'outstanding'
    CHECK (status IN ('outstanding','likely','matched','archived','ignored')),
  match_confidence INTEGER NOT NULL DEFAULT 0,
  matched_receipt_id INTEGER REFERENCES receipts(id),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submitted_by_user_id INTEGER REFERENCES users(id),
  jotform_submission_id TEXT UNIQUE,
  jotform_status TEXT NOT NULL DEFAULT 'none'
    CHECK (jotform_status IN ('none','pending','forwarded','failed','inbound')),
  merchant_name TEXT,
  amount_cents INTEGER,
  transaction_date TEXT,
  category TEXT,
  line_items TEXT,
  image_path TEXT,
  image_sha256 TEXT,
  notes TEXT,
  linked_transaction_id INTEGER REFERENCES transactions(id),
  raw_payload TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  receipt_id INTEGER NOT NULL REFERENCES receipts(id),
  confidence_score INTEGER NOT NULL,
  score_breakdown TEXT,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','confirmed','rejected','undone')),
  confirmed_by_user_id INTEGER REFERENCES users(id),
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (transaction_id, receipt_id)
);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  reminder_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  sent_at TEXT NOT NULL,
  status TEXT NOT NULL,
  UNIQUE (transaction_id, user_id, reminder_type)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  timestamp TEXT NOT NULL,
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_cardholder ON transactions(cardholder_user_id);
CREATE INDEX IF NOT EXISTS idx_tx_assigned ON transactions(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_submitter ON receipts(submitted_by_user_id);
CREATE INDEX IF NOT EXISTS idx_matches_tx ON matches(transaction_id);
`);

// Lightweight migrations for columns added after the initial schema.
const receiptCols = db.prepare(`PRAGMA table_info(receipts)`).all().map((c) => c.name);
if (!receiptCols.includes('image_url')) {
  db.exec(`ALTER TABLE receipts ADD COLUMN image_url TEXT`); // Jotform-hosted image (system of record)
}

const DEFAULT_REMINDER_SCHEDULE = { initial: 0, second: 2, third: 5, escalate: 7, periodic: 7 };

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), now());
}

module.exports = { db, getSetting, setSetting, DEFAULT_REMINDER_SCHEDULE };
