// Seeds demo users and imports the sample AMEX CSV. Idempotent.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');
const { now } = require('../src/lib');
const csvImport = require('../src/services/csvImport');
const matching = require('../src/services/matching');

function upsertUser({ name, email, phone, role, cardholder_name, card_last_four, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, role, active, cardholder_name, card_last_four, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
    .run(name, email, phone || null, bcrypt.hashSync(password, 10), role,
      cardholder_name || null, card_last_four || null, now(), now());
  return info.lastInsertRowid;
}

const adminId = upsertUser({
  name: 'Alex Admin', email: 'admin@example.org', phone: '555-0100',
  role: 'admin', password: 'ChangeMe123!',
});
upsertUser({
  name: 'Maria Santos', email: 'maria@example.org', phone: '555-0101', role: 'level1',
  cardholder_name: 'MARIA SANTOS', card_last_four: '1005', password: 'ChangeMe123!',
});
upsertUser({
  name: 'David Okafor', email: 'david@example.org', phone: '555-0102', role: 'level1',
  cardholder_name: 'DAVID OKAFOR', card_last_four: '2013', password: 'ChangeMe123!',
});
upsertUser({
  name: 'Jake Levy', email: 'jake@example.org', phone: '555-0103', role: 'level2',
  password: 'ChangeMe123!',
});

const csvPath = path.join(__dirname, '..', 'sample-data', 'amex_sample.csv');
const result = csvImport.importCsv(fs.readFileSync(csvPath, 'utf8'), adminId);
for (const id of result.importedIds) matching.runForTransaction(id);

console.log('Seed complete.');
console.log(`  Users: admin@example.org / maria@example.org / david@example.org / jake@example.org`);
console.log(`  Password for all: ChangeMe123!  (change these immediately for real use)`);
console.log(`  CSV import: ${result.imported} imported, ${result.skipped_duplicates} duplicates skipped, ${result.skipped_credits} credits skipped`);
