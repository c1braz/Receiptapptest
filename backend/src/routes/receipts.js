const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { db, getSetting } = require('../db');
const { now, parseCents, toDateStr } = require('../lib');
const { requireAuth } = require('../middleware/auth');
const audit = require('../services/audit');
const matching = require('../services/matching');
const jotform = require('../services/jotform');

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploadsDir),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 6);
      cb(null, `rcpt-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpe?g|png|heic|heif|webp)|application\/pdf)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only image or PDF receipts are accepted'), ok);
  },
});

router.use(requireAuth);

// Live dropdown options pulled from the Jotform form, so Jotform edits
// (new line items, categories) reach the app without an app release.
// NOTE: must be declared before the '/:id' routes.
router.get('/form-options', (req, res) => {
  res.json({ options: getSetting('jotform_options', {}) });
});

// Submit a receipt: multipart with "image" file + fields.
router.post('/', upload.single('image'), (req, res) => {
  const body = req.body || {};
  const amount = parseCents(body.amount);
  const date = toDateStr(body.transaction_date);
  const merchant = (body.merchant_name || '').trim();
  const fail = (code, msg) => {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(code).json({ error: msg });
  };
  if (amount === null || amount <= 0) return fail(400, 'A valid positive amount is required');
  if (!date) return fail(400, 'A valid transaction_date is required (YYYY-MM-DD or MM/DD/YYYY)');
  if (!merchant) return fail(400, 'merchant_name is required');
  if (!req.file) return fail(400, 'A receipt image is required (multipart field "image")');

  let linkedTxId = null;
  if (body.transaction_id) {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(body.transaction_id));
    if (!tx) return fail(400, 'Linked transaction not found');
    const mine = req.user.role === 'admin' || tx.cardholder_user_id === req.user.id || tx.assigned_user_id === req.user.id;
    if (!mine) return fail(403, 'You are not responsible for that charge');
    linkedTxId = tx.id;
  }

  const sha = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
  const dupImage = db.prepare('SELECT id FROM receipts WHERE image_sha256 = ?').get(sha);

  const info = db.prepare(`
    INSERT INTO receipts (submitted_by_user_id, jotform_status, merchant_name, amount_cents, transaction_date,
      category, line_items, image_path, image_sha256, notes, linked_transaction_id, created_at, updated_at)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, merchant, amount, date, body.category || null,
      JSON.stringify({
        wine: body.wine_items || null,
        class: body.class_items || null,
        line_item: body.line_item || null,
        program_class: body.program_class || null,
      }),
      req.file.path, sha, body.notes || null, linkedTxId, now(), now());
  const receiptId = info.lastInsertRowid;

  audit.log(req.user.id, 'receipt_submitted', 'receipt', receiptId,
    { linkedTxId, duplicate_image_of: dupImage ? dupImage.id : null });
  matching.runForReceipt(receiptId);
  // Forward to Jotform asynchronously; local record is already safe.
  jotform.forwardReceipt(receiptId).catch(() => {});

  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  res.status(201).json({ receipt, duplicate_image_warning: Boolean(dupImage) });
});

router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'admin') {
    rows = db.prepare(`SELECT r.*, u.name AS submitted_by_name FROM receipts r
                       LEFT JOIN users u ON u.id = r.submitted_by_user_id
                       ORDER BY r.created_at DESC`).all();
    if (req.query.unmatched === '1') {
      rows = rows.filter((r) =>
        !db.prepare('SELECT 1 FROM transactions WHERE matched_receipt_id = ?').get(r.id));
    }
  } else {
    rows = db.prepare(`SELECT r.*, u.name AS submitted_by_name FROM receipts r
                       LEFT JOIN users u ON u.id = r.submitted_by_user_id
                       WHERE r.submitted_by_user_id = ? ORDER BY r.created_at DESC`).all(req.user.id);
  }
  res.json({ receipts: rows });
});

function canSeeReceipt(user, receipt) {
  if (user.role === 'admin') return true;
  if (receipt.submitted_by_user_id === user.id) return true;
  // Cardholder/assignee may view a receipt matched or linked to their charge.
  const tx = db.prepare(`SELECT 1 FROM transactions
    WHERE (matched_receipt_id = ? OR id = ?)
      AND (cardholder_user_id = ? OR assigned_user_id = ?)`)
    .get(receipt.id, receipt.linked_transaction_id || -1, user.id, user.id);
  return Boolean(tx);
}

router.get('/:id', (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt || !canSeeReceipt(req.user, receipt)) return res.status(404).json({ error: 'Receipt not found' });
  res.json({ receipt });
});

// Images only ever served through this authenticated, role-checked endpoint.
// Local file = temporary buffer (pre-forward); Jotform URL = system of record.
router.get('/:id/image', async (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt || !canSeeReceipt(req.user, receipt)) return res.status(404).json({ error: 'Receipt not found' });
  if (receipt.image_path && fs.existsSync(receipt.image_path)) {
    return res.sendFile(path.resolve(receipt.image_path));
  }
  if (receipt.image_url) {
    try {
      const { contentType, buffer } = await jotform.fetchImage(receipt.image_url);
      res.type(contentType).send(buffer);
    } catch {
      res.status(502).json({ error: 'Image is stored in Jotform but could not be fetched right now' });
    }
    return;
  }
  res.status(404).json({ error: 'No image stored for this receipt' });
});

module.exports = router;
