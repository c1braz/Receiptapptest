// AMEX CSV importer. Auto-detects standard AMEX export headers plus a generic
// fallback. Dedup on external reference if present, else content hash.
const crypto = require('crypto');
const { db } = require('../db');
const { now, parseCents, toDateStr } = require('../lib');
const audit = require('./audit');

// Minimal RFC-4180-ish parser (quotes, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES = {
  transaction_date: ['date', 'transaction date'],
  posted_date: ['posted date', 'post date'],
  merchant: ['description', 'merchant', 'merchant name', 'vendor'],
  cardholder: ['card member', 'cardholder', 'card holder', 'name on card'],
  account: ['account #', 'account number', 'card number', 'last four', 'account'],
  amount: ['amount', 'charge amount'],
  reference: ['reference', 'reference number', 'transaction id', 'extended details reference'],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((raw, idx) => {
    const h = raw.trim().toLowerCase();
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[key] === undefined && aliases.includes(h)) map[key] = idx;
    }
  });
  return map;
}

function lastFour(accountField) {
  const digits = String(accountField || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

// AMEX exports are inconsistent about whitespace in names ("BRIAN  GAMEL" vs
// "BRIAN GAMEL"), so compare with collapsed whitespace.
const collapseName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

function findCardholder(cardMemberName, last4) {
  if (cardMemberName) {
    const wanted = collapseName(cardMemberName);
    const byName = db.prepare(
      `SELECT id, cardholder_name FROM users WHERE active = 1 AND cardholder_name IS NOT NULL`)
      .all().find((u) => collapseName(u.cardholder_name) === wanted);
    if (byName) return byName.id;
  }
  if (last4) {
    const byCard = db.prepare('SELECT id FROM users WHERE active = 1 AND card_last_four = ?').get(last4);
    if (byCard) return byCard.id;
  }
  return null;
}

function importCsv(csvText, actorUserId) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV has no data rows');
  const headers = mapHeaders(rows[0]);
  for (const required of ['transaction_date', 'merchant', 'amount']) {
    if (headers[required] === undefined) {
      throw new Error(`Could not find a "${HEADER_ALIASES[required][0]}" column in the CSV header`);
    }
  }

  const result = { imported: 0, skipped_duplicates: 0, skipped_credits: 0, errors: [] };
  const insert = db.prepare(`
    INSERT INTO transactions (external_transaction_id, import_hash, import_source, cardholder_user_id,
      merchant_name, amount_cents, transaction_date, posted_date, card_last_four, status, created_at, updated_at)
    VALUES (?, ?, 'csv', ?, ?, ?, ?, ?, ?, 'outstanding', ?, ?)`);
  const importedIds = [];
  // Two genuinely identical charges (same day/amount/merchant, e.g. repeated
  // Amazon orders) must not collapse into one when there is no reference
  // column: suffix repeat occurrences within the file. File ordering is stable
  // across re-exports, so re-imports still dedup correctly.
  const seenInFile = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    try {
      const date = toDateStr(r[headers.transaction_date]);
      const amount = parseCents(r[headers.amount]);
      const merchant = (r[headers.merchant] || '').trim();
      if (!date || amount === null || !merchant) {
        result.errors.push({ row: i + 1, error: 'missing/unparseable date, amount, or merchant' });
        continue;
      }
      if (amount <= 0) { result.skipped_credits++; continue; } // payments/credits
      const reference = headers.reference !== undefined ? (r[headers.reference] || '').trim() : '';
      const last4 = headers.account !== undefined ? lastFour(r[headers.account]) : null;
      const cardMember = headers.cardholder !== undefined ? (r[headers.cardholder] || '').trim() : null;
      let hash;
      if (reference) {
        hash = `ref:${reference}`;
      } else {
        const base = 'sha:' + crypto.createHash('sha256').update(`${date}|${amount}|${merchant.toUpperCase()}|${last4 || ''}`).digest('hex');
        const occurrence = (seenInFile.get(base) || 0) + 1;
        seenInFile.set(base, occurrence);
        hash = occurrence === 1 ? base : `${base}#${occurrence}`;
      }

      const dup = db.prepare('SELECT id FROM transactions WHERE import_hash = ?').get(hash);
      if (dup) { result.skipped_duplicates++; continue; }

      const posted = headers.posted_date !== undefined ? toDateStr(r[headers.posted_date]) : null;
      const info = insert.run(reference || null, hash, findCardholder(cardMember, last4),
        merchant, amount, date, posted, last4, now(), now());
      importedIds.push(info.lastInsertRowid);
      result.imported++;
    } catch (err) {
      result.errors.push({ row: i + 1, error: err.message });
    }
  }

  audit.log(actorUserId, 'csv_import', 'transaction', null, result);
  return { ...result, importedIds };
}

module.exports = { importCsv, parseCsv };
