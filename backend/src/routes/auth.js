const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { now } = require('../lib');
const { requireAuth, signToken, publicUser } = require('../middleware/auth');
const audit = require('../services/audit');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(String(email).trim());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (!user.active) return res.status(401).json({ error: 'Account is deactivated' });
  audit.log(user.id, 'login');
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (!bcrypt.compareSync(current_password || '', req.user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), now(), req.user.id);
  audit.log(req.user.id, 'password_changed', 'user', req.user.id);
  res.json({ ok: true });
});

module.exports = router;
