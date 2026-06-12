const express = require('express');
const config = require('../config');
const { db, getSetting, setSetting, DEFAULT_REMINDER_SCHEDULE } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const audit = require('../services/audit');
const jotform = require('../services/jotform');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const EDITABLE = ['jotform_api_key', 'jotform_form_id', 'reminder_schedule',
  'auto_match_enabled', 'auto_match_threshold', 'email_templates', 'sms_settings_placeholder'];

function mask(key) {
  return key ? `••••${String(key).slice(-4)}` : null;
}

router.get('/', (req, res) => {
  res.json({
    jotform_api_key_masked: mask(getSetting('jotform_api_key', config.jotform.apiKey)),
    jotform_form_id: getSetting('jotform_form_id', config.jotform.formId),
    jotform_field_map: getSetting('jotform_field_map'),
    jotform_map_warnings: getSetting('jotform_map_warnings', []),
    reminder_schedule: { ...DEFAULT_REMINDER_SCHEDULE, ...getSetting('reminder_schedule', {}) },
    auto_match_enabled: getSetting('auto_match_enabled', false),
    auto_match_threshold: getSetting('auto_match_threshold', 90),
    email_templates: getSetting('email_templates', null),
    sms_settings_placeholder: getSetting('sms_settings_placeholder', { enabled: false, provider: null }),
  });
});

router.put('/', (req, res) => {
  const changed = [];
  for (const key of EDITABLE) {
    if (key in (req.body || {})) {
      setSetting(key, req.body[key]);
      changed.push(key);
    }
  }
  if (!changed.length) return res.status(400).json({ error: 'No editable settings supplied' });
  audit.log(req.user.id, 'settings_changed', null, null, { keys: changed });
  res.json({ ok: true, changed });
});

router.post('/jotform/refresh-map', async (req, res) => {
  if (!jotform.configured()) return res.status(400).json({ error: 'Set jotform_api_key and jotform_form_id first' });
  try {
    res.json(await jotform.refreshFieldMap(req.user.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/jotform/sync', async (req, res) => {
  if (!jotform.configured()) return res.status(400).json({ error: 'Set jotform_api_key and jotform_form_id first' });
  try {
    res.json(await jotform.syncSubmissions());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/audit-logs', (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_logs a
                           LEFT JOIN users u ON u.id = a.user_id
                           ORDER BY a.id DESC LIMIT 200`).all();
  res.json({ logs: rows });
});

module.exports = router;
