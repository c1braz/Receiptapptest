const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('outstanding','likely') THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN status IN ('outstanding','likely') THEN amount_cents ELSE 0 END) AS open_amount_cents,
      SUM(CASE WHEN status = 'likely' THEN 1 ELSE 0 END) AS likely_count,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
      SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived_count
    FROM transactions`).get();

  const byUser = db.prepare(`
    SELECT COALESCE(u.name, 'Unassigned') AS user_name, COUNT(*) AS count, SUM(t.amount_cents) AS amount_cents
    FROM transactions t
    LEFT JOIN users u ON u.id = COALESCE(t.assigned_user_id, t.cardholder_user_id)
    WHERE t.status IN ('outstanding','likely')
    GROUP BY u.id ORDER BY count DESC`).all();

  const oldest = db.prepare(`
    SELECT t.*, COALESCE(au.name, ch.name) AS responsible_name
    FROM transactions t
    LEFT JOIN users ch ON ch.id = t.cardholder_user_id
    LEFT JOIN users au ON au.id = t.assigned_user_id
    WHERE t.status IN ('outstanding','likely')
    ORDER BY t.transaction_date ASC LIMIT 5`).all();

  const likelyNeedingReview = db.prepare(`
    SELECT t.id AS transaction_id, t.merchant_name, t.amount_cents, t.transaction_date,
           m.receipt_id, m.confidence_score
    FROM transactions t
    JOIN matches m ON m.transaction_id = t.id AND m.status = 'suggested'
    WHERE t.status = 'likely'
    ORDER BY m.confidence_score DESC LIMIT 20`).all();

  const recentlyReconciled = db.prepare(`
    SELECT t.*, COALESCE(au.name, ch.name) AS responsible_name
    FROM transactions t
    LEFT JOIN users ch ON ch.id = t.cardholder_user_id
    LEFT JOIN users au ON au.id = t.assigned_user_id
    WHERE t.status IN ('matched','archived')
    ORDER BY t.updated_at DESC LIMIT 10`).all();

  res.json({ totals, byUser, oldest, likelyNeedingReview, recentlyReconciled });
});

module.exports = router;
