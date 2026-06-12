// Jotform integration: dynamic field discovery (form edits don't break us),
// outbound forwarding of in-app receipts, inbound polling of direct submissions.
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { db, getSetting, setSetting } = require('../db');
const { now, parseCents, toDateStr } = require('../lib');
const audit = require('./audit');
const matching = require('./matching');
const { verifyToken } = require('./tokens');

function creds() {
  return {
    apiKey: getSetting('jotform_api_key', config.jotform.apiKey),
    formId: getSetting('jotform_form_id', config.jotform.formId),
  };
}

function configured() {
  const { apiKey, formId } = creds();
  return Boolean(apiKey && formId);
}

async function jfFetch(pathname, options = {}) {
  const { apiKey } = creds();
  const url = `${config.jotform.apiBase}${pathname}${pathname.includes('?') ? '&' : '?'}apiKey=${apiKey}`;
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`Jotform API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).content;
}

// Map our logical fields to live question IDs by inspecting type + label.
// Re-run any time; survives renames/reordering as long as labels stay recognizable.
function deriveFieldMap(questions) {
  const map = {};
  const entries = Object.entries(questions); // qid -> question
  const findBy = (pred) => {
    const hit = entries.find(([, q]) => pred(q));
    return hit ? hit[0] : null;
  };
  const labelHas = (q, words) => words.some((w) => (q.text || '').toLowerCase().includes(w));

  map.name = findBy((q) => q.type === 'control_fullname') ||
             findBy((q) => q.type === 'control_textbox' && labelHas(q, ['name']));
  map.email = findBy((q) => q.type === 'control_email');
  map.transaction_date = findBy((q) => q.type === 'control_datetime' && labelHas(q, ['date']));
  map.amount = findBy((q) => labelHas(q, ['amount']) && ['control_number', 'control_textbox', 'control_spinner'].includes(q.type));
  map.merchant = findBy((q) => labelHas(q, ['vendor', 'merchant']));
  map.category = findBy((q) => q.type === 'control_dropdown' && labelHas(q, ['category']));
  map.wine_items = findBy((q) => q.type === 'control_checkbox' && labelHas(q, ['wine']));
  map.class_items = findBy((q) => q.type === 'control_checkbox' && labelHas(q, ['class', 'program']));
  map.line_item = findBy((q) => q.type === 'control_dropdown' && labelHas(q, ['line item']));
  map.program_class = findBy((q) => q.type === 'control_textbox' && labelHas(q, ['qbo', 'program/project', 'program /']));
  map.notes = findBy((q) => q.type === 'control_textarea');
  map.image = findBy((q) => q.type === 'control_fileupload');
  map.related_charge = findBy((q) => labelHas(q, ['amex', 'charge id', 'related']) && q.type === 'control_textbox');
  return map;
}

// Dropdown options for fields the mobile app renders as pickers, so form
// edits in Jotform (new line items, categories) reach the app without a release.
function deriveOptions(questions, map) {
  const options = {};
  for (const key of ['category', 'line_item']) {
    const q = map[key] && questions[map[key]];
    if (q && q.options) options[key] = q.options.split('|').filter(Boolean);
  }
  return options;
}

async function refreshFieldMap(actorUserId = null) {
  const { formId } = creds();
  const questions = await jfFetch(`/form/${formId}/questions`);
  const map = deriveFieldMap(questions);
  setSetting('jotform_field_map', map);
  setSetting('jotform_options', deriveOptions(questions, map));
  // Unique question names are required by the submit endpoint (file uploads).
  const names = {};
  for (const [qid, q] of Object.entries(questions)) if (q.name) names[qid] = q.name;
  setSetting('jotform_field_names', names);
  const missing = ['amount', 'transaction_date', 'image'].filter((k) => !map[k]);
  setSetting('jotform_map_warnings', missing);
  audit.log(actorUserId, 'jotform_field_map_refreshed', null, null, { map, missing });
  return { map, missing };
}

async function getFieldMap() {
  return getSetting('jotform_field_map') || (await refreshFieldMap()).map;
}

// Submit-endpoint field name: "q{qid}_{uniqueName}" (some names already carry
// the prefix, depending on how the question was created).
function fieldName(qid, names) {
  const n = qid && (names || {})[qid];
  if (!n) return null;
  return n.startsWith(`q${qid}_`) ? n : `q${qid}_${n}`;
}

// Forward an in-app receipt to Jotform so finance sees everything in one place.
// Uses the form-submit endpoint (not the REST submissions API) because only it
// accepts file uploads. The new submission is then located via a unique marker
// written into the related-charge field. The local DB row already exists;
// failure here just queues a retry.
async function forwardReceipt(receiptId) {
  if (!configured()) return;
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(receiptId);
  if (!receipt || receipt.jotform_submission_id) return;
  try {
    const map = await getFieldMap();
    let names = getSetting('jotform_field_names');
    if (!names) { await refreshFieldMap(); names = getSetting('jotform_field_names', {}); }
    const { formId } = creds();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(receipt.submitted_by_user_id);
    const marker = `local-rcpt-${receiptId}`;

    const form = new FormData();
    form.append('formID', formId);
    const put = (qid, value) => {
      const n = fieldName(qid, names);
      if (n && value != null && value !== '') form.append(n, String(value));
    };
    if (user) {
      const nameField = fieldName(map.name, names);
      if (nameField) {
        const [first, ...rest] = user.name.split(' ');
        form.append(`${nameField}[first]`, first);
        form.append(`${nameField}[last]`, rest.join(' ') || '-');
      }
      put(map.email, user.email);
    }
    const dateField = fieldName(map.transaction_date, names);
    if (dateField && receipt.transaction_date) {
      const [y, m, d] = receipt.transaction_date.split('-');
      form.append(`${dateField}[year]`, y);
      form.append(`${dateField}[month]`, m);
      form.append(`${dateField}[day]`, d);
    }
    put(map.amount, (receipt.amount_cents / 100).toFixed(2));
    put(map.merchant, receipt.merchant_name);
    put(map.category, receipt.category);
    let items = {};
    try { items = JSON.parse(receipt.line_items || '{}'); } catch { /* legacy rows */ }
    put(map.wine_items, items.wine);
    put(map.class_items, items.class);
    put(map.line_item, items.line_item);
    put(map.program_class, items.program_class);
    put(map.notes, receipt.notes);
    put(map.related_charge, marker);
    const imgField = fieldName(map.image, names);
    if (imgField && receipt.image_path && fs.existsSync(receipt.image_path)) {
      const buf = fs.readFileSync(receipt.image_path);
      form.append(`${imgField}[]`, new Blob([buf]), path.basename(receipt.image_path));
    }

    const res = await fetch(`https://submit.jotform.com/submit/${formId}`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Jotform submit failed (${res.status})`);

    // The submit endpoint returns HTML, not an id — find ours by the marker.
    let submissionId = null;
    for (let attempt = 1; attempt <= 3 && !submissionId; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      const subs = await jfFetch(`/form/${formId}/submissions?limit=20`);
      const hit = (subs || []).find((s) => (s.answers?.[map.related_charge]?.answer || '') === marker);
      if (hit) submissionId = String(hit.id);
    }
    // Jotform is the system of record for images: once the upload is
    // confirmed there, record its URL and delete the local buffer copy so
    // the Render disk stays metadata-only.
    let imageUrl = null;
    if (submissionId && receipt.image_path) {
      const sub = await jfFetch(`/submission/${submissionId}`);
      const uploaded = sub?.answers?.[map.image]?.answer;
      if (Array.isArray(uploaded) && uploaded[0]) {
        imageUrl = uploaded[0];
        fs.unlink(receipt.image_path, () => {});
      }
    }
    // If the id lookup fails, syncSubmissions will still claim it later via
    // the marker (see local-rcpt handling there), so don't mark failed —
    // a retry would create a duplicate submission in Jotform.
    db.prepare(`UPDATE receipts SET jotform_submission_id = ?, jotform_status = 'forwarded',
                image_url = COALESCE(?, image_url),
                image_path = CASE WHEN ? IS NOT NULL THEN NULL ELSE image_path END,
                updated_at = ? WHERE id = ?`)
      .run(submissionId, imageUrl, imageUrl, now(), receiptId);
  } catch (err) {
    db.prepare(`UPDATE receipts SET jotform_status = 'failed', updated_at = ? WHERE id = ?`).run(now(), receiptId);
    audit.log(null, 'jotform_forward_failed', 'receipt', receiptId, { error: err.message });
  }
}

async function retryFailedForwards() {
  if (!configured()) return;
  const rows = db.prepare(`SELECT id FROM receipts WHERE jotform_status IN ('pending','failed')`).all();
  for (const r of rows) await forwardReceipt(r.id);
}

function answerValue(answers, qid) {
  if (!qid || !answers[qid]) return null;
  const a = answers[qid].answer;
  if (a == null) return null;
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.join(', ');
  if (typeof a === 'object') return Object.values(a).filter(Boolean).join(' ');
  return String(a);
}

// Poll Jotform for submissions made via the hosted form link (no app needed).
async function syncSubmissions() {
  if (!configured()) return { imported: 0 };
  const { formId } = creds();
  const map = await getFieldMap();
  const submissions = await jfFetch(`/form/${formId}/submissions?limit=200&orderby=created_at`);
  let imported = 0;
  for (const sub of submissions || []) {
    const existing = db.prepare('SELECT id FROM receipts WHERE jotform_submission_id = ?').get(String(sub.id));
    if (existing) continue;
    const answers = sub.answers || {};
    const email = (answerValue(answers, map.email) || '').trim().toLowerCase();
    const user = email ? db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(email) : null;

    // A reminder deep-link prefills the related-charge field with an action token.
    let linkedTxId = null;
    const related = (answerValue(answers, map.related_charge) || '').trim();

    // Our own forwarded receipts carry a local-rcpt marker: claim the
    // submission id for that receipt instead of importing a duplicate.
    const own = related.match(/^local-rcpt-(\d+)$/);
    if (own) {
      const ownReceipt = db.prepare('SELECT id, jotform_submission_id FROM receipts WHERE id = ?').get(Number(own[1]));
      if (ownReceipt) {
        if (!ownReceipt.jotform_submission_id) {
          db.prepare(`UPDATE receipts SET jotform_submission_id = ?, jotform_status = 'forwarded', updated_at = ? WHERE id = ?`)
            .run(String(sub.id), now(), ownReceipt.id);
        }
        continue;
      }
    }
    if (related) {
      const tok = verifyToken(related);
      if (tok) linkedTxId = tok.transactionId;
      else if (/^local-tx-(\d+)$/.test(related)) linkedTxId = Number(related.match(/^local-tx-(\d+)$/)[1]);
    }

    // Images stay hosted in Jotform (system of record); we store the URL only.
    const imageAnswer = answerValue(answers, map.image) || '';
    const imageUrl = imageAnswer.split(',').map((s) => s.trim()).find((s) => /^https?:\/\//.test(s)) || null;

    const info = db.prepare(`
      INSERT INTO receipts (submitted_by_user_id, jotform_submission_id, jotform_status, merchant_name,
        amount_cents, transaction_date, category, line_items, image_url, notes,
        linked_transaction_id, raw_payload, created_at, updated_at)
      VALUES (?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        user ? user.id : null, String(sub.id),
        answerValue(answers, map.merchant),
        parseCents(answerValue(answers, map.amount)),
        toDateStr(answerValue(answers, map.transaction_date)),
        answerValue(answers, map.category),
        JSON.stringify({
          wine: answerValue(answers, map.wine_items),
          class: answerValue(answers, map.class_items),
          line_item: answerValue(answers, map.line_item),
          program_class: answerValue(answers, map.program_class),
        }),
        imageUrl,
        answerValue(answers, map.notes),
        linkedTxId, JSON.stringify(sub), now(), now(),
      );
    matching.runForReceipt(info.lastInsertRowid);
    imported++;
  }
  if (imported) audit.log(null, 'jotform_sync', 'receipt', null, { imported });
  return { imported };
}

// Proxy a Jotform-hosted image for the authenticated image endpoint.
async function fetchImage(imageUrl) {
  const { apiKey } = creds();
  const res = await fetch(`${imageUrl}${imageUrl.includes('?') ? '&' : '?'}apiKey=${apiKey}`);
  if (!res.ok) throw new Error(`Jotform image fetch failed (${res.status})`);
  return {
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    buffer: Buffer.from(await res.arrayBuffer()),
  };
}

module.exports = { configured, refreshFieldMap, getFieldMap, forwardReceipt, retryFailedForwards, syncSubmissions, deriveFieldMap, deriveOptions, fetchImage };
