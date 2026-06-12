// Reminder engine. Runs on a cron loop; recipient is re-resolved every cycle
// (assignment wins over cardholder), so reassignment redirects reminders and
// matched/ignored/archived charges never trigger sends. The UNIQUE constraint
// on (transaction, user, type) makes each reminder send-once.
const { db, getSetting, DEFAULT_REMINDER_SCHEDULE } = require('../db');
const { now, formatCents, daysSince } = require('../lib');
const config = require('../config');
const { sendEmail } = require('./mailer');
const { createToken } = require('./tokens');

function jotformUrl(chargeToken) {
  const formId = getSetting('jotform_form_id', config.jotform.formId);
  return `https://form.jotform.com/${formId}?relatedAmexChargeId=${encodeURIComponent(chargeToken)}`;
}

function chargeEmail(tx, user, kind) {
  const token = createToken(tx.id, user.id, 'respond');
  const actionUrl = `${config.appBaseUrl}/api/action/${token}`;
  const formUrl = jotformUrl(token);
  const intro = {
    initial: 'Your business card was charged. Please submit the receipt.',
    second: 'Reminder: a charge on your business card is still missing its receipt.',
    third: 'Second reminder: this charge is still missing a receipt.',
    periodic: 'This charge is still missing a receipt.',
  }[kind] || 'A charge assigned to you is missing a receipt.';
  const subject = `${kind === 'initial' ? 'Card charged' : 'Receipt needed'}: ${formatCents(tx.amount_cents)} at ${tx.merchant_name}`;
  const html = `
    <p>Hi ${user.name},</p>
    <p>${intro}</p>
    <ul>
      <li><b>Amount:</b> ${formatCents(tx.amount_cents)}</li>
      <li><b>Merchant:</b> ${tx.merchant_name}</li>
      <li><b>Date:</b> ${tx.transaction_date}</li>
    </ul>
    <p><a href="${formUrl}">Upload the receipt</a> (takes ~1 minute, photo from your phone is fine).</p>
    <p>Didn't make this purchase? <a href="${actionUrl}">Assign it to the person who used the card, add a note, or flag it as not yours</a>.</p>`;
  return { subject, html };
}

// `type` is the dedup key recorded in the table (e.g. 'periodic_2');
// `kind` picks the email wording (defaults to type).
async function sendReminder(tx, user, type, kind = type) {
  const { subject, html } = chargeEmail(tx, user, kind);
  const status = await sendEmail({ to: user.email, subject, html });
  db.prepare(`INSERT OR IGNORE INTO reminders (transaction_id, user_id, reminder_type, channel, sent_at, status)
              VALUES (?, ?, ?, 'email', ?, ?)`)
    .run(tx.id, user.id, type, now(), status);
}

async function sendEscalation(tx, responsibleUser, ageDays) {
  const admins = db.prepare(`SELECT * FROM users WHERE role = 'admin' AND active = 1`).all();
  for (const admin of admins) {
    const already = db.prepare(
      `SELECT 1 FROM reminders WHERE transaction_id = ? AND user_id = ? AND reminder_type = 'escalation'`)
      .get(tx.id, admin.id);
    if (already) continue;
    const status = await sendEmail({
      to: admin.email,
      subject: `Escalation: receipt missing ${ageDays} days — ${formatCents(tx.amount_cents)} at ${tx.merchant_name}`,
      html: `<p>${responsibleUser ? responsibleUser.name : 'Unassigned charge'} has not submitted a receipt for
             ${formatCents(tx.amount_cents)} at ${tx.merchant_name} (${tx.transaction_date}),
             outstanding ${ageDays} days.</p>`,
    });
    db.prepare(`INSERT OR IGNORE INTO reminders (transaction_id, user_id, reminder_type, channel, sent_at, status)
                VALUES (?, ?, 'escalation', 'email', ?, ?)`)
      .run(tx.id, admin.id, now(), status);
  }
}

function dueTypes(ageDays, schedule) {
  const types = [];
  if (ageDays >= schedule.initial) types.push('initial');
  if (ageDays >= schedule.second) types.push('second');
  if (ageDays >= schedule.third) types.push('third');
  if (ageDays >= schedule.escalate + schedule.periodic) {
    const bucket = Math.floor((ageDays - schedule.escalate) / schedule.periodic);
    types.push(`periodic_${bucket}`);
  }
  return types;
}

async function runReminderCycle() {
  const schedule = { ...DEFAULT_REMINDER_SCHEDULE, ...getSetting('reminder_schedule', {}) };
  const open = db.prepare(`SELECT * FROM transactions WHERE status IN ('outstanding','likely')`).all();
  let sent = 0;
  for (const tx of open) {
    const responsibleId = tx.assigned_user_id || tx.cardholder_user_id;
    const user = responsibleId
      ? db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(responsibleId)
      : null;
    const ageDays = daysSince(tx.created_at);

    if (user && JSON.parse(user.notification_prefs || '{}').email !== false) {
      for (const type of dueTypes(ageDays, schedule)) {
        const already = db.prepare(
          `SELECT 1 FROM reminders WHERE transaction_id = ? AND user_id = ? AND reminder_type = ?`)
          .get(tx.id, user.id, type);
        if (!already) {
          await sendReminder(tx, user, type, type.startsWith('periodic') ? 'periodic' : type);
          sent++;
        }
      }
    }
    if (ageDays >= schedule.escalate) await sendEscalation(tx, user, ageDays);
  }
  return { open: open.length, sent };
}

// Immediate "your card was charged" email when new transactions are imported.
async function notifyNewTransactions(transactionIds) {
  for (const id of transactionIds) {
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!tx || !['outstanding', 'likely'].includes(tx.status)) continue;
    const responsibleId = tx.assigned_user_id || tx.cardholder_user_id;
    if (!responsibleId) continue;
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(responsibleId);
    if (!user || JSON.parse(user.notification_prefs || '{}').email === false) continue;
    const already = db.prepare(
      `SELECT 1 FROM reminders WHERE transaction_id = ? AND user_id = ? AND reminder_type = 'initial'`)
      .get(tx.id, user.id);
    if (!already) await sendReminder(tx, user, 'initial');
  }
}

module.exports = { runReminderCycle, notifyNewTransactions, dueTypes };
