const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { now } = require('../lib');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');
const matching = require('../services/matching');
const csvImport = require('../services/csvImport');
const reminders = require('../services/reminders');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
router.use(requireAuth);

// Role-scoped visibility, enforced in SQL.
function scopeClause(user) {
  if (user.role === 'admin') return { where: '1=1', params: [] };
  if (user.role === 'level1') {
    return { where: '(t.cardholder_user_id = ? OR t.assigned_user_id = ?)', params: [user.id, user.id] };
  }
  return { where: 't.assigned_user_id = ?', params: [user.id] };
}

const BASE_SELECT = `
  SELECT t.*, ch.name AS cardholder_name_display, au.name AS assigned_user_name
  FROM transactions t
  LEFT JOIN users ch ON ch.id = t.cardholder_user_id
  LEFT JOIN users au ON au.id = t.assigned_user_id`;

router.get('/', (req, res) => {
  const { where, params } = scopeClause(req.user);
  const status = req.query.status;
  let sql = `${BASE_SELECT} WHERE ${where}`;
  if (status === 'open') sql += ` AND t.status IN ('outstanding','likely')`;
  else if (status) { sql += ` AND t.status = ?`; params.push(status); }
  sql += ' ORDER BY t.transaction_date DESC, t.id DESC';
  res.json({ transactions: db.prepare(sql).all(...params) });
});

function loadScoped(req, res) {
  const { where, params } = scopeClause(req.user);
  const tx = db.prepare(`${BASE_SELECT} WHERE t.id = ? AND ${where}`).get(req.params.id, ...params);
  if (!tx) res.status(404).json({ error: 'Transaction not found' });
  return tx;
}

router.get('/:id', (req, res) => {
  const tx = loadScoped(req, res);
  if (!tx) return;
  const candidates = db.prepare(`
    SELECT m.*, r.merchant_name AS receipt_merchant, r.amount_cents AS receipt_amount_cents,
           r.transaction_date AS receipt_date, r.category, r.notes, r.image_path IS NOT NULL AS has_image,
           u.name AS submitted_by_name
    FROM matches m JOIN receipts r ON r.id = m.receipt_id
    LEFT JOIN users u ON u.id = r.submitted_by_user_id
    WHERE m.transaction_id = ? AND m.status IN ('suggested','confirmed')
    ORDER BY m.confidence_score DESC`).all(tx.id);
  res.json({ transaction: tx, candidates });
});

// CSV import (admin): multipart file field "file" or raw text body field "csv".
router.post('/import', requireAdmin, upload.single('file'), async (req, res) => {
  const csvText = req.file ? req.file.buffer.toString('utf8') : (req.body || {}).csv;
  if (!csvText) return res.status(400).json({ error: 'Provide a CSV file (field "file") or "csv" text body' });
  let result;
  try {
    result = csvImport.importCsv(csvText, req.user.id);
  } catch (err) {
    audit.log(req.user.id, 'csv_import_failed', null, null, { error: err.message });
    return res.status(400).json({ error: err.message });
  }
  for (const id of result.importedIds) matching.runForTransaction(id);
  await reminders.notifyNewTransactions(result.importedIds);
  const { importedIds, ...summary } = result;
  res.json(summary);
});

// Reassign: admin, or the cardholder of this charge lending it out.
router.post('/:id/assign', (req, res) => {
  const tx = loadScoped(req, res);
  if (!tx) return;
  if (req.user.role !== 'admin' && tx.cardholder_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only an admin or the cardholder can reassign this charge' });
  }
  const targetId = Number((req.body || {}).user_id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target || !target.active) {
    return res.status(400).json({ error: 'Assignee must be an existing active user' });
  }
  db.prepare('UPDATE transactions SET assigned_user_id = ?, updated_at = ? WHERE id = ?')
    .run(target.id, now(), tx.id);
  audit.log(req.user.id, 'charge_reassigned', 'transaction', tx.id, { to: target.id });
  reminders.notifyNewTransactions([tx.id]).catch(() => {});
  res.json({ ok: true });
});

router.post('/:id/confirm-match', requireAdmin, (req, res) => {
  const receiptId = Number((req.body || {}).receipt_id);
  if (!receiptId) return res.status(400).json({ error: 'receipt_id required' });
  try {
    matching.confirmMatch(Number(req.params.id), receiptId, req.user.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.post('/:id/undo-match', requireAdmin, (req, res) => {
  try {
    matching.undoMatch(Number(req.params.id), req.user.id);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ ok: true });
});

router.post('/:id/archive', requireAdmin, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare(`UPDATE transactions SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?`)
    .run(now(), now(), tx.id);
  audit.log(req.user.id, 'charge_archived', 'transaction', tx.id);
  res.json({ ok: true });
});

router.post('/:id/unarchive', requireAdmin, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx || tx.status !== 'archived') return res.status(404).json({ error: 'Archived transaction not found' });
  const restored = tx.matched_receipt_id ? 'matched' : 'outstanding';
  db.prepare(`UPDATE transactions SET status = ?, archived_at = NULL, updated_at = ? WHERE id = ?`)
    .run(restored, now(), tx.id);
  audit.log(req.user.id, 'charge_unarchived', 'transaction', tx.id);
  res.json({ ok: true, status: restored });
});

router.post('/:id/ignore', requireAdmin, (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  db.prepare(`UPDATE transactions SET status = 'ignored', updated_at = ? WHERE id = ?`).run(now(), tx.id);
  audit.log(req.user.id, 'charge_ignored', 'transaction', tx.id, { reason: (req.body || {}).reason });
  res.json({ ok: true });
});

module.exports = router;
