// HMAC-signed, single-purpose action tokens backing secure email links.
// Stateless verification + a DB record for audit/consumption tracking.
const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');
const { now } = require('../lib');

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', config.jwtSecret).update(payload).digest('base64url');
}

function createToken(transactionId, userId, purpose, ttlDays = 30) {
  const expiresAt = new Date(Date.now() + ttlDays * 86400000).toISOString();
  const payload = b64url(JSON.stringify({ t: transactionId, u: userId, p: purpose, e: expiresAt }));
  const token = `${payload}.${sign(payload)}`;
  db.prepare(`INSERT INTO action_tokens (token, transaction_id, user_id, purpose, expires_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(token, transactionId, userId, purpose, expiresAt, now());
  return token;
}

function verifyToken(token) {
  const dot = (token || '').lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (new Date(data.e).getTime() < Date.now()) return null;
  return { transactionId: data.t, userId: data.u, purpose: data.p };
}

function consumeToken(token) {
  db.prepare('UPDATE action_tokens SET consumed_at = ? WHERE token = ?').run(now(), token);
}

module.exports = { createToken, verifyToken, consumeToken };
