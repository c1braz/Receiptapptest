// Scoring matcher. Suggests matches; never confirms on its own unless the
// admin has enabled auto_match_enabled (default off).
const { db, getSetting } = require('../db');
const { now, dayDiff } = require('../lib');
const audit = require('./audit');

const SUGGEST_THRESHOLD = 55;

const NOISE_WORDS = new Set(['LLC', 'INC', 'CO', 'CORP', 'THE', 'AND', 'OF', 'COM', 'STORE', 'SHOP']);

function normalizeMerchant(s) {
  return (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE_WORDS.has(t) && !/^\d+$/.test(t))
    .join(' ');
}

// 0..1 similarity: containment or token overlap.
function merchantSimilarity(a, b) {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function scoreMatch(tx, receipt) {
  const breakdown = {};
  let score = 0;

  if (receipt.amount_cents != null) {
    if (receipt.amount_cents === tx.amount_cents) breakdown.amount = 40;
    else if (Math.abs(receipt.amount_cents - tx.amount_cents) <= 100) breakdown.amount = 25;
    else breakdown.amount = 0;
    score += breakdown.amount;
  }

  if (receipt.transaction_date && tx.transaction_date) {
    const dd = Math.abs(dayDiff(tx.transaction_date, receipt.transaction_date));
    breakdown.date = dd === 0 ? 20 : dd <= 2 ? 15 : dd <= 5 ? 8 : 0;
    score += breakdown.date;
  }

  const sim = merchantSimilarity(tx.merchant_name, receipt.merchant_name);
  breakdown.merchant = Math.round(sim * 20);
  score += breakdown.merchant;

  const responsible = tx.assigned_user_id || tx.cardholder_user_id;
  if (receipt.submitted_by_user_id && receipt.submitted_by_user_id === responsible) {
    breakdown.submitter = 15;
    score += 15;
  }

  if (receipt.transaction_date && tx.transaction_date && receipt.created_at) {
    const submittedDay = receipt.created_at.slice(0, 10);
    const lag = dayDiff(tx.transaction_date, submittedDay);
    if (lag >= 0 && lag <= 7) {
      breakdown.promptness = 5;
      score += 5;
    }
  }

  // Deep-link from a reminder email pins the receipt to this exact charge.
  if (receipt.linked_transaction_id === tx.id) {
    score = Math.max(score, 95);
    breakdown.deep_link = true;
  }

  return { score: Math.min(score, 100), breakdown };
}

function upsertSuggestion(tx, receipt) {
  const { score, breakdown } = scoreMatch(tx, receipt);
  if (score < SUGGEST_THRESHOLD) return null;
  db.prepare(`INSERT INTO matches (transaction_id, receipt_id, confidence_score, score_breakdown, status, created_at)
              VALUES (?, ?, ?, ?, 'suggested', ?)
              ON CONFLICT(transaction_id, receipt_id) DO UPDATE SET
                confidence_score = excluded.confidence_score,
                score_breakdown = excluded.score_breakdown`)
    .run(tx.id, receipt.id, score, JSON.stringify(breakdown), now());
  if (tx.status === 'outstanding' || (tx.status === 'likely' && score > tx.match_confidence)) {
    db.prepare(`UPDATE transactions SET status = 'likely', match_confidence = ?, updated_at = ? WHERE id = ?`)
      .run(score, now(), tx.id);
  }
  return score;
}

function openTransactions() {
  return db.prepare(`SELECT * FROM transactions WHERE status IN ('outstanding','likely')`).all();
}

function unmatchedReceipts() {
  return db.prepare(`SELECT r.* FROM receipts r
                     WHERE r.id NOT IN (SELECT matched_receipt_id FROM transactions WHERE matched_receipt_id IS NOT NULL)`).all();
}

function runForReceipt(receiptId) {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  if (!receipt) return;
  for (const tx of openTransactions()) upsertSuggestion(tx, receipt);
  maybeAutoConfirm();
}

function runForTransaction(txId) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!tx || !['outstanding', 'likely'].includes(tx.status)) return;
  for (const receipt of unmatchedReceipts()) upsertSuggestion(tx, receipt);
  maybeAutoConfirm();
}

function maybeAutoConfirm() {
  if (!getSetting('auto_match_enabled', false)) return;
  const threshold = getSetting('auto_match_threshold', 90);
  const rows = db.prepare(`SELECT m.* FROM matches m
                           JOIN transactions t ON t.id = m.transaction_id
                           WHERE m.status = 'suggested' AND m.confidence_score >= ?
                             AND t.status IN ('outstanding','likely')`).all(threshold);
  for (const m of rows) confirmMatch(m.transaction_id, m.receipt_id, null, true);
}

function confirmMatch(transactionId, receiptId, adminUserId, auto = false) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  if (!tx || !receipt) throw new Error('transaction or receipt not found');
  const { score, breakdown } = scoreMatch(tx, receipt);
  db.prepare(`INSERT INTO matches (transaction_id, receipt_id, confidence_score, score_breakdown, status, confirmed_by_user_id, confirmed_at, created_at)
              VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)
              ON CONFLICT(transaction_id, receipt_id) DO UPDATE SET
                status = 'confirmed', confirmed_by_user_id = excluded.confirmed_by_user_id,
                confirmed_at = excluded.confirmed_at`)
    .run(transactionId, receiptId, score, JSON.stringify(breakdown), adminUserId, now(), now());
  db.prepare(`UPDATE transactions SET status = 'matched', matched_receipt_id = ?, match_confidence = ?, updated_at = ? WHERE id = ?`)
    .run(receiptId, Math.max(score, tx.match_confidence), now(), transactionId);
  audit.log(adminUserId, auto ? 'match_auto_confirmed' : 'match_confirmed', 'transaction', transactionId, { receiptId, score });
}

function undoMatch(transactionId, adminUserId) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
  if (!tx || !tx.matched_receipt_id) throw new Error('transaction has no confirmed match');
  db.prepare(`UPDATE matches SET status = 'undone' WHERE transaction_id = ? AND receipt_id = ? AND status = 'confirmed'`)
    .run(transactionId, tx.matched_receipt_id);
  db.prepare(`UPDATE transactions SET status = 'outstanding', matched_receipt_id = NULL, match_confidence = 0,
              archived_at = NULL, updated_at = ? WHERE id = ?`)
    .run(now(), transactionId);
  audit.log(adminUserId, 'match_undone', 'transaction', transactionId, { previousReceiptId: tx.matched_receipt_id });
  runForTransaction(transactionId);
}

module.exports = {
  scoreMatch, merchantSimilarity, normalizeMerchant,
  runForReceipt, runForTransaction, confirmMatch, undoMatch, SUGGEST_THRESHOLD,
};
