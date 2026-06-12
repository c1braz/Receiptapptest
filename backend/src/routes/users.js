const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db } = require('../db');
const { now } = require('../lib');
const { requireAuth, requireAdmin, publicUser } = require('../middleware/auth');
const audit = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

// Active users any logged-in user may assign a charge to (name+id only).
router.get('/assignable', (req, res) => {
  const rows = db.prepare(`SELECT id, name, role FROM users WHERE active = 1 ORDER BY name`).all();
  res.json({ users: rows });
});

router.use(requireAdmin);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY name').all();
  res.json({ users: rows.map(publicUser) });
});

router.post('/', (req, res) => {
  const { name, email, phone, role, cardholder_name, card_last_four, password } = req.body || {};
  if (!name || !email || !['admin', 'level1', 'level2'].includes(role)) {
    return res.status(400).json({ error: 'name, email, and a valid role are required' });
  }
  if (role === 'level1' && !cardholder_name) {
    return res.status(400).json({ error: 'Level 1 users need cardholder_name (as shown on AMEX exports)' });
  }
  const tempPassword = password || crypto.randomBytes(6).toString('base64url');
  try {
    const info = db.prepare(`
      INSERT INTO users (name, email, phone, password_hash, role, active, cardholder_name, card_last_four, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .run(name, String(email).trim().toLowerCase(), phone || null,
        bcrypt.hashSync(tempPassword, 10), role,
        cardholder_name || null, card_last_four || null, now(), now());
    audit.log(req.user.id, 'user_created', 'user', info.lastInsertRowid, { role });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ user: publicUser(user), temp_password: password ? undefined : tempPassword });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Email already in use' });
    throw err;
  }
});

router.patch('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const allowed = ['name', 'email', 'phone', 'role', 'active', 'cardholder_name', 'card_last_four', 'notification_prefs'];
  const updates = {};
  for (const key of allowed) if (key in (req.body || {})) updates[key] = req.body[key];
  if (updates.role && !['admin', 'level1', 'level2'].includes(updates.role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if ('active' in updates) updates.active = updates.active ? 1 : 0;
  if (updates.notification_prefs && typeof updates.notification_prefs === 'object') {
    updates.notification_prefs = JSON.stringify(updates.notification_prefs);
  }
  if (req.body.new_password) {
    updates.password_hash = bcrypt.hashSync(String(req.body.new_password), 10);
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No editable fields supplied' });
  const sets = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE users SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...Object.values(updates), now(), user.id);
  audit.log(req.user.id, 'user_updated', 'user', user.id, { fields: Object.keys(updates) });
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

module.exports = router;
