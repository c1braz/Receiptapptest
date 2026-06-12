// Public (token-authenticated) endpoints backing the secure links in reminder
// emails: view the charge, reassign it, add a note, or flag "not mine".
// No login required — the HMAC token is scoped to one transaction + user.
const express = require('express');
const { db, getSetting } = require('../db');
const { now, formatCents } = require('../lib');
const config = require('../config');
const { verifyToken, consumeToken } = require('../services/tokens');
const audit = require('../services/audit');
const reminders = require('../services/reminders');

const router = express.Router();

function loadFromToken(req, res) {
  const data = verifyToken(req.params.token);
  if (!data) {
    res.status(401).json({ error: 'This link is invalid or has expired. Ask an admin to resend it.' });
    return null;
  }
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(data.transactionId);
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(data.userId);
  if (!tx || !user) {
    res.status(404).json({ error: 'Charge or user no longer available' });
    return null;
  }
  return { tx, user, token: req.params.token };
}

// Tiny HTML page so the email link works on any device with no app installed.
router.get('/:token', (req, res) => {
  const ctx = loadFromToken(req, res);
  if (!ctx) return;
  const { tx, user } = ctx;
  const formId = getSetting('jotform_form_id', config.jotform.formId);
  const formUrl = `https://form.jotform.com/${formId}?relatedAmexChargeId=${encodeURIComponent(req.params.token)}`;
  const assignable = db.prepare(`SELECT id, name FROM users WHERE active = 1 AND id != ? ORDER BY name`).all(user.id);
  const options = assignable.map((u) => `<option value="${u.id}">${u.name}</option>`).join('');
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:-apple-system,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem">
  <h2>Charge: ${formatCents(tx.amount_cents)} at ${tx.merchant_name}</h2>
  <p>${tx.transaction_date} · status: ${tx.status}</p>
  <p><a href="${formUrl}" style="display:inline-block;background:#0a7;color:#fff;padding:.7rem 1.2rem;border-radius:8px;text-decoration:none">Upload receipt</a></p>
  <hr><h3>Someone else used the card?</h3>
  <form method="POST" action="/api/action/${req.params.token}/reassign">
    <select name="user_id" required>${options}</select>
    <button type="submit">Assign charge to them</button>
  </form>
  <hr><h3>Not your charge / suspected error?</h3>
  <form method="POST" action="/api/action/${req.params.token}/not-mine">
    <input name="note" placeholder="Optional note" style="width:100%;margin-bottom:.5rem">
    <button type="submit">Flag for admin review</button>
  </form></body>`);
});

router.post('/:token/reassign', express.urlencoded({ extended: false }), (req, res) => {
  const ctx = loadFromToken(req, res);
  if (!ctx) return;
  if (ctx.tx.cardholder_user_id !== ctx.user.id && ctx.tx.assigned_user_id !== ctx.user.id) {
    return res.status(403).json({ error: 'This charge is not assigned to you' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(req.body.user_id));
  if (!target) return res.status(400).json({ error: 'Assignee must be an active user' });
  db.prepare('UPDATE transactions SET assigned_user_id = ?, updated_at = ? WHERE id = ?')
    .run(target.id, now(), ctx.tx.id);
  audit.log(ctx.user.id, 'charge_reassigned_via_link', 'transaction', ctx.tx.id, { to: target.id });
  consumeToken(ctx.token);
  reminders.notifyNewTransactions([ctx.tx.id]).catch(() => {});
  res.type('html').send(`<body style="font-family:sans-serif;text-align:center;margin-top:3rem">
    <h2>Done — ${target.name} is now responsible for this charge and will receive the reminders.</h2></body>`);
});

router.post('/:token/not-mine', express.urlencoded({ extended: false }), (req, res) => {
  const ctx = loadFromToken(req, res);
  if (!ctx) return;
  audit.log(ctx.user.id, 'charge_flagged_not_mine', 'transaction', ctx.tx.id, { note: req.body.note || null });
  consumeToken(ctx.token);
  res.type('html').send(`<body style="font-family:sans-serif;text-align:center;margin-top:3rem">
    <h2>Flagged. An admin will review this charge.</h2></body>`);
});

router.post('/:token/note', express.json(), (req, res) => {
  const ctx = loadFromToken(req, res);
  if (!ctx) return;
  audit.log(ctx.user.id, 'charge_note_added', 'transaction', ctx.tx.id, { note: (req.body || {}).note });
  res.json({ ok: true });
});

module.exports = router;
