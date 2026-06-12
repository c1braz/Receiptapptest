const express = require('express');
const cron = require('node-cron');
const config = require('./config');
const { db } = require('./db'); // applies schema on boot

// First-boot bootstrap: create the initial admin from env vars when the user
// table is empty (safe to leave the vars set afterwards — this never runs again).
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count === 0) {
    const bcrypt = require('bcryptjs');
    const { now } = require('./lib');
    db.prepare(`INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
                VALUES (?, ?, ?, 'admin', 1, ?, ?)`)
      .run(process.env.ADMIN_NAME || 'Administrator',
        process.env.ADMIN_EMAIL.toLowerCase(), bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10), now(), now());
    console.log(`Bootstrapped initial admin: ${process.env.ADMIN_EMAIL}`);
  }
}

const app = express();
app.use(express.json({ limit: '2mb' }));

// Friendly landing page — this service is an API; humans usually arrive here
// by clicking the service URL.
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:-apple-system,sans-serif;max-width:520px;margin:3rem auto;padding:0 1rem;color:#1c2733">
    <h2>🧾 Woodstock Arts — Receipt &amp; AMEX Reconciliation API</h2>
    <p>This server is running normally. It has no web pages — it powers the
    <b>Receipts mobile app</b> and the email reminder links.</p>
    <ul>
      <li>Submit a receipt: <a href="https://form.jotform.com/261617924502052">Jotform receipt form</a></li>
      <li>Service status: <a href="/api/health">/api/health</a></li>
    </ul>
    <p style="color:#687585;font-size:13px">Staff: use the Receipts app on your phone to log in.</p>
  </body>`);
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/receipts', require('./routes/receipts'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/action', require('./routes/actions'));

// Central error handler (multer errors, unexpected throws) — no silent failures.
app.use((err, req, res, next) => {
  console.error('[api:error]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

function startJobs() {
  const reminders = require('./services/reminders');
  const jotform = require('./services/jotform');
  // Hourly: reminder cycle + retry of failed Jotform forwards.
  cron.schedule('5 * * * *', async () => {
    try {
      const result = await reminders.runReminderCycle();
      if (result.sent) console.log(`[reminders] sent ${result.sent} (open charges: ${result.open})`);
      await jotform.retryFailedForwards();
    } catch (err) {
      console.error('[reminders] cycle failed:', err.message);
    }
  });
  // Every 15 min: pull submissions made directly on the hosted Jotform form.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const { imported } = await jotform.syncSubmissions();
      if (imported) console.log(`[jotform] imported ${imported} submissions`);
    } catch (err) {
      console.error('[jotform] sync failed:', err.message);
    }
  });
}

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    if (config.jwtSecret === 'dev-insecure-secret-change-me') {
      console.warn('WARNING: JWT_SECRET is not set — using an insecure dev default.');
    }
    startJobs();
  });
}

module.exports = app;
