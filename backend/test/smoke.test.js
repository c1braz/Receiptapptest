// End-to-end smoke tests: boots the real app on an ephemeral port with a
// throwaway database and exercises auth, RBAC, import dedup, matching,
// archive/undo, reminders, and image access control over HTTP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'amex-test-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.JWT_SECRET = 'test-secret';
process.env.JOTFORM_API_KEY = ''; // keep Jotform calls disabled in tests

const bcrypt = require('bcryptjs');
const app = require('../src/server');
const { db } = require('../src/db');
const { now, parseCents, toDateStr, dayDiff } = require('../src/lib');
const matching = require('../src/services/matching');
const reminders = require('../src/services/reminders');

let base;
let server;
const tokens = {};

const SAMPLE_CSV = fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'amex_sample.csv'), 'utf8');
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64');

function addUser(name, email, role, extra = {}) {
  return db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, active, cardholder_name, card_last_four, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, email, extra.phone || null, bcrypt.hashSync('Password1!', 4), role,
      extra.active === false ? 0 : 1, extra.cardholder_name || null,
      extra.card_last_four || null, now(), now()).lastInsertRowid;
}

async function api(method, pathname, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`${base}${pathname}`, { method, headers, body });
  let data = null;
  try { data = await res.json(); } catch { /* html endpoints */ }
  return { status: res.status, data };
}

test.before(async () => {
  addUser('Alex Admin', 'admin@test.org', 'admin');
  addUser('Maria Santos', 'maria@test.org', 'level1', { cardholder_name: 'MARIA SANTOS', card_last_four: '1005' });
  addUser('David Okafor', 'david@test.org', 'level1', { cardholder_name: 'DAVID OKAFOR', card_last_four: '2013' });
  addUser('Jake Levy', 'jake@test.org', 'level2');
  addUser('Ina Inactive', 'ina@test.org', 'level2', { active: false });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  for (const who of ['admin', 'maria', 'david', 'jake']) {
    const r = await api('POST', '/api/auth/login', { json: { email: `${who}@test.org`, password: 'Password1!' } });
    assert.equal(r.status, 200, `${who} login`);
    tokens[who] = r.data.token;
  }
});

test.after(() => server && server.close());

test('lib: money and calendar-date handling', () => {
  assert.equal(parseCents('1,234.56'), 123456);
  assert.equal(parseCents('$45.18'), 4518);
  assert.equal(parseCents('not money'), null);
  assert.equal(toDateStr('05/28/2026'), '2026-05-28');
  assert.equal(toDateStr('2026-06-03'), '2026-06-03');
  assert.equal(dayDiff('2026-05-30', '2026-06-01'), 2);
});

test('login rejects bad password and inactive users', async () => {
  assert.equal((await api('POST', '/api/auth/login', { json: { email: 'maria@test.org', password: 'wrong' } })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { json: { email: 'ina@test.org', password: 'Password1!' } })).status, 401);
});

test('CSV import: parses AMEX format, attributes cardholders, dedups on re-import', async () => {
  const first = await api('POST', '/api/transactions/import', { token: tokens.admin, json: { csv: SAMPLE_CSV } });
  assert.equal(first.status, 200);
  assert.equal(first.data.imported, 6);          // 7 rows minus 1 payment credit
  assert.equal(first.data.skipped_credits, 1);
  const again = await api('POST', '/api/transactions/import', { token: tokens.admin, json: { csv: SAMPLE_CSV } });
  assert.equal(again.data.imported, 0);
  assert.equal(again.data.skipped_duplicates, 6);

  const mariasCount = db.prepare(`SELECT COUNT(*) c FROM transactions t JOIN users u ON u.id = t.cardholder_user_id
                                  WHERE u.email = 'maria@test.org'`).get().c;
  assert.equal(mariasCount, 4);
  // non-admin cannot import
  assert.equal((await api('POST', '/api/transactions/import', { token: tokens.maria, json: { csv: SAMPLE_CSV } })).status, 403);
});

test('RBAC: level1 sees only own charges; level2 sees only assigned', async () => {
  const maria = await api('GET', '/api/transactions', { token: tokens.maria });
  assert.equal(maria.data.transactions.length, 4);
  assert.ok(maria.data.transactions.every((t) => t.card_last_four === '1005'));

  const jake = await api('GET', '/api/transactions', { token: tokens.jake });
  assert.equal(jake.data.transactions.length, 0);

  const admin = await api('GET', '/api/transactions', { token: tokens.admin });
  assert.equal(admin.data.transactions.length, 6);
});

test('assignment: cardholder can lend to active user; inactive rejected; strangers blocked', async () => {
  const txMaria = db.prepare(`SELECT id FROM transactions WHERE merchant_name LIKE 'AMAZON%'`).get().id;
  const txDavid = db.prepare(`SELECT id FROM transactions WHERE merchant_name LIKE 'HOME DEPOT%'`).get().id;
  const jakeId = db.prepare(`SELECT id FROM users WHERE email = 'jake@test.org'`).get().id;
  const inaId = db.prepare(`SELECT id FROM users WHERE email = 'ina@test.org'`).get().id;

  assert.equal((await api('POST', `/api/transactions/${txMaria}/assign`, { token: tokens.maria, json: { user_id: inaId } })).status, 400);
  assert.equal((await api('POST', `/api/transactions/${txMaria}/assign`, { token: tokens.maria, json: { user_id: jakeId } })).status, 200);
  // David's charge isn't even visible to Maria
  assert.equal((await api('POST', `/api/transactions/${txDavid}/assign`, { token: tokens.maria, json: { user_id: jakeId } })).status, 404);
  // Jake (level2) now sees exactly his assigned charge
  const jake = await api('GET', '/api/transactions', { token: tokens.jake });
  assert.equal(jake.data.transactions.length, 1);
  assert.equal(jake.data.transactions[0].id, txMaria);
});

test('receipt submission: validation, image required, matching produces likely match', async () => {
  // missing image -> 400
  const noImage = new FormData();
  noImage.append('amount', '326.90');
  noImage.append('transaction_date', '2026-05-30');
  noImage.append('merchant_name', 'Total Wine');
  assert.equal((await api('POST', '/api/receipts', { token: tokens.maria, form: noImage })).status, 400);

  const form = new FormData();
  form.append('amount', '326.90');
  form.append('transaction_date', '2026-05-30');
  form.append('merchant_name', 'Total Wine');
  form.append('category', 'Wine / Beverage');
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'receipt.png');
  const r = await api('POST', '/api/receipts', { token: tokens.maria, form });
  assert.equal(r.status, 201);

  const tx = db.prepare(`SELECT * FROM transactions WHERE merchant_name LIKE 'TOTAL WINE%'`).get();
  assert.equal(tx.status, 'likely');
  assert.ok(tx.match_confidence >= 55, `confidence ${tx.match_confidence}`);

  const detail = await api('GET', `/api/transactions/${tx.id}`, { token: tokens.admin });
  assert.ok(detail.data.candidates.length >= 1);
  assert.equal(detail.data.candidates[0].receipt_id, r.data.receipt.id);
});

test('duplicate image submission is flagged', async () => {
  const form = new FormData();
  form.append('amount', '45.18');
  form.append('transaction_date', '2026-06-02');
  form.append('merchant_name', 'Amazon');
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'again.png');
  const r = await api('POST', '/api/receipts', { token: tokens.maria, form });
  assert.equal(r.status, 201);
  assert.equal(r.data.duplicate_image_warning, true);
});

test('confirm match -> matched leaves open list; archive stays viewable; undo restores', async () => {
  const tx = db.prepare(`SELECT * FROM transactions WHERE merchant_name LIKE 'TOTAL WINE%'`).get();
  const receiptId = db.prepare(`SELECT receipt_id FROM matches WHERE transaction_id = ? ORDER BY confidence_score DESC`).get(tx.id).receipt_id;

  // non-admin cannot confirm
  assert.equal((await api('POST', `/api/transactions/${tx.id}/confirm-match`, { token: tokens.maria, json: { receipt_id: receiptId } })).status, 403);
  assert.equal((await api('POST', `/api/transactions/${tx.id}/confirm-match`, { token: tokens.admin, json: { receipt_id: receiptId } })).status, 200);

  const open = await api('GET', '/api/transactions?status=open', { token: tokens.admin });
  assert.ok(!open.data.transactions.find((t) => t.id === tx.id));

  assert.equal((await api('POST', `/api/transactions/${tx.id}/archive`, { token: tokens.admin })).status, 200);
  const archived = await api('GET', '/api/transactions?status=archived', { token: tokens.admin });
  assert.ok(archived.data.transactions.find((t) => t.id === tx.id), 'archived stays viewable');

  assert.equal((await api('POST', `/api/transactions/${tx.id}/undo-match`, { token: tokens.admin })).status, 200);
  const after = db.prepare('SELECT * FROM transactions WHERE id = ?').get(tx.id);
  assert.equal(after.matched_receipt_id, null);
  assert.ok(['outstanding', 'likely'].includes(after.status));
});

test('receipt images are access-controlled', async () => {
  const receipt = db.prepare(`SELECT * FROM receipts ORDER BY id LIMIT 1`).get();
  const mine = await fetch(`${base}/api/receipts/${receipt.id}/image`, { headers: { Authorization: `Bearer ${tokens.maria}` } });
  assert.equal(mine.status, 200);
  const stranger = await fetch(`${base}/api/receipts/${receipt.id}/image`, { headers: { Authorization: `Bearer ${tokens.david}` } });
  assert.equal(stranger.status, 404);
  const anon = await fetch(`${base}/api/receipts/${receipt.id}/image`);
  assert.equal(anon.status, 401);
});

test('reminders: sent once per stage, to assignee not cardholder, never for resolved charges', async () => {
  // Initial "card charged" emails were already sent during CSV import.
  const txAmazon = db.prepare(`SELECT * FROM transactions WHERE merchant_name LIKE 'AMAZON%'`).get();
  const jakeId = db.prepare(`SELECT id FROM users WHERE email = 'jake@test.org'`).get().id;
  const mariaId = db.prepare(`SELECT id FROM users WHERE email = 'maria@test.org'`).get().id;
  assert.ok(db.prepare(`SELECT 1 FROM reminders WHERE transaction_id = ? AND reminder_type = 'initial'`).get(txAmazon.id),
    'initial reminder sent at import time');

  // Backdate the Amazon charge 3 days: the 'second' stage is due and must go
  // to Jake (assignee after the earlier reassignment test), not Maria.
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  db.prepare('UPDATE transactions SET created_at = ? WHERE id = ?').run(threeDaysAgo, txAmazon.id);
  const cycle = await reminders.runReminderCycle();
  assert.ok(cycle.sent > 0);
  const secondStage = db.prepare(
    `SELECT * FROM reminders WHERE transaction_id = ? AND reminder_type = 'second'`).all(txAmazon.id);
  assert.equal(secondStage.length, 1);
  assert.equal(secondStage[0].user_id, jakeId);
  assert.notEqual(secondStage[0].user_id, mariaId);

  const repeat = await reminders.runReminderCycle();
  assert.equal(repeat.sent, 0, 'no duplicate reminders in same stage');

  // matched/ignored charges get no reminders
  const txWine = db.prepare(`SELECT * FROM transactions WHERE merchant_name LIKE 'TOTAL WINE%'`).get();
  const receiptId = db.prepare(`SELECT receipt_id FROM matches WHERE transaction_id = ?`).get(txWine.id).receipt_id;
  matching.confirmMatch(txWine.id, receiptId, 1);
  const before = db.prepare(`SELECT COUNT(*) c FROM reminders WHERE transaction_id = ?`).get(txWine.id).c;
  await reminders.runReminderCycle();
  const after = db.prepare(`SELECT COUNT(*) c FROM reminders WHERE transaction_id = ?`).get(txWine.id).c;
  assert.equal(after, before);
});

test('reminder schedule stages', () => {
  const schedule = { initial: 0, second: 2, third: 5, escalate: 7, periodic: 7 };
  assert.deepEqual(reminders.dueTypes(0, schedule), ['initial']);
  assert.deepEqual(reminders.dueTypes(3, schedule), ['initial', 'second']);
  assert.deepEqual(reminders.dueTypes(6, schedule), ['initial', 'second', 'third']);
  assert.deepEqual(reminders.dueTypes(15, schedule), ['initial', 'second', 'third', 'periodic_1']);
  assert.deepEqual(reminders.dueTypes(22, schedule), ['initial', 'second', 'third', 'periodic_2']);
});

test('matching scorer: competing same-amount charges rank by date+merchant', () => {
  const receipt = {
    amount_cents: 5000, transaction_date: '2026-06-01', merchant_name: 'Office Depot',
    submitted_by_user_id: 9, created_at: '2026-06-02T00:00:00Z', linked_transaction_id: null,
  };
  const rightTx = { id: 1, amount_cents: 5000, transaction_date: '2026-06-01', merchant_name: 'OFFICE DEPOT #112', cardholder_user_id: 9, assigned_user_id: null };
  const decoyTx = { id: 2, amount_cents: 5000, transaction_date: '2026-06-03', merchant_name: 'STAPLES #80', cardholder_user_id: 4, assigned_user_id: null };
  const right = matching.scoreMatch(rightTx, receipt).score;
  const decoy = matching.scoreMatch(decoyTx, receipt).score;
  assert.ok(right > decoy, `${right} > ${decoy}`);
  assert.ok(right >= 80);
  // deep-linked receipt pins to its charge
  const linked = matching.scoreMatch(rightTx, { ...receipt, linked_transaction_id: 1 });
  assert.ok(linked.score >= 95);
});

test('CSV import: real AMEX activity-export format', async () => {
  // Mirrors the org's actual export: a Receipt flag column, 5-digit account
  // codes, double-spaced card member names, quoted commas in merchants, and
  // two genuinely identical charges that must both import.
  const realFormat = [
    'Date,Receipt,Description,Card Member,Account #,Amount',
    '06/08/2026,,AMAZON MARKEPLACE NA PA,TEST PERSON,-13000,28.74',
    '06/08/2026,,AMAZON MARKEPLACE NA PA,TEST PERSON,-13000,28.74',
    '06/09/2026,*,BANANAS AND BEEHIVESWoodstock           GA,TEST  PERSON,-13000,90.00',
    '06/05/2026,,"CHECKR, INC CHECKR.CSAN FRANCISCO       CA",TEST PERSON,-13000,1816.27',
  ].join('\n');
  const testPersonId = addUser('Test Person', 'testperson@test.org', 'level1', { cardholder_name: 'TEST PERSON' });

  const r = await api('POST', '/api/transactions/import', { token: tokens.admin, json: { csv: realFormat } });
  assert.equal(r.status, 200);
  assert.equal(r.data.imported, 4, 'identical same-day charges both import');
  const again = await api('POST', '/api/transactions/import', { token: tokens.admin, json: { csv: realFormat } });
  assert.equal(again.data.imported, 0);
  assert.equal(again.data.skipped_duplicates, 4);

  const rows = db.prepare('SELECT * FROM transactions WHERE cardholder_user_id = ?').all(testPersonId);
  assert.equal(rows.length, 4, 'double-spaced card member name still attributes');
  assert.ok(rows.find((t) => t.merchant_name.startsWith('CHECKR, INC')), 'quoted comma preserved');
  assert.ok(rows.every((t) => t.card_last_four === '3000'));
});

test('jotform field map adapts to the edited live form (QBO line items)', () => {
  const jotform = require('../src/services/jotform');
  // Mirrors the real form structure after the org edited it in Jotform.
  const questions = {
    2: { type: 'control_fullname', text: 'Full Name' },
    3: { type: 'control_email', text: 'Email' },
    4: { type: 'control_datetime', text: 'Transaction Date' },
    5: { type: 'control_number', text: 'Transaction Amount (USD)' },
    6: { type: 'control_textbox', text: 'Vendor / Merchant Name' },
    7: { type: 'control_dropdown', text: 'Purchase Category', options: 'Supplies|Travel|Other' },
    10: { type: 'control_textarea', text: 'Notes / Description' },
    11: { type: 'control_fileupload', text: 'Receipt Image' },
    12: { type: 'control_textbox', text: 'Related AMEX Charge ID' },
    14: { type: 'control_dropdown', text: 'Line Item', options: 'Accounting|Props|Sets' },
    15: { type: 'control_textbox', text: 'Program/Project (QBO Class)' },
  };
  const map = jotform.deriveFieldMap(questions);
  assert.equal(map.amount, '5');
  assert.equal(map.transaction_date, '4');
  assert.equal(map.image, '11');
  assert.equal(map.line_item, '14');
  assert.equal(map.program_class, '15');
  assert.equal(map.related_charge, '12');
  const options = jotform.deriveOptions(questions, map);
  assert.deepEqual(options.line_item, ['Accounting', 'Props', 'Sets']);
  assert.deepEqual(options.category, ['Supplies', 'Travel', 'Other']);
});

test('receipt line_item and program_class are stored', async () => {
  const form = new FormData();
  form.append('amount', '63.75');
  form.append('transaction_date', '2026-06-06');
  form.append('merchant_name', 'Joann Stores');
  form.append('line_item', 'Costume');
  form.append('program_class', 'Summer Camp 2026');
  form.append('image', new Blob([PNG], { type: 'image/png' }), 'joann.png');
  const r = await api('POST', '/api/receipts', { token: tokens.maria, form });
  assert.equal(r.status, 201);
  const items = JSON.parse(r.data.receipt.line_items);
  assert.equal(items.line_item, 'Costume');
  assert.equal(items.program_class, 'Summer Camp 2026');
});

test('admin dashboard and settings round-trip', async () => {
  const dash = await api('GET', '/api/dashboard', { token: tokens.admin });
  assert.equal(dash.status, 200);
  assert.ok(dash.data.totals.open_count >= 1);
  assert.ok(Array.isArray(dash.data.byUser));

  assert.equal((await api('GET', '/api/dashboard', { token: tokens.maria })).status, 403);

  const put = await api('PUT', '/api/settings', {
    token: tokens.admin,
    json: { reminder_schedule: { initial: 0, second: 3, third: 6, escalate: 10, periodic: 7 }, jotform_form_id: '261617924502052' },
  });
  assert.equal(put.status, 200);
  const got = await api('GET', '/api/settings', { token: tokens.admin });
  assert.equal(got.data.reminder_schedule.second, 3);
  assert.equal(got.data.jotform_form_id, '261617924502052');
});

test('audit trail records manual changes', async () => {
  const logs = await api('GET', '/api/settings/audit-logs', { token: tokens.admin });
  const actions = logs.data.logs.map((l) => l.action);
  for (const expected of ['csv_import', 'charge_reassigned', 'receipt_submitted', 'match_confirmed', 'match_undone', 'charge_archived', 'settings_changed']) {
    assert.ok(actions.includes(expected), `audit log missing ${expected}`);
  }
});
