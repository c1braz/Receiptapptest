// Shared helpers: money as integer cents, dates as YYYY-MM-DD calendar strings.

function now() {
  return new Date().toISOString();
}

// "1,234.56" | "$12.30" | 12.3 -> integer cents. Returns null if unparseable.
function parseCents(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = String(value).replace(/[$,\s]/g, '');
  if (!/^-?\d*(\.\d{1,4})?$/.test(cleaned) || cleaned === '' || cleaned === '-') return null;
  return Math.round(parseFloat(cleaned) * 100);
}

function formatCents(cents) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Accepts MM/DD/YYYY, M/D/YY, YYYY-MM-DD -> "YYYY-MM-DD" or null.
// Pure string handling: no Date objects, so no timezone drift.
function toDateStr(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

// Whole-day difference between two YYYY-MM-DD strings (b - a), via UTC.
function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Whole days elapsed since an ISO timestamp.
function daysSince(isoTimestamp) {
  return Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 86400000);
}

module.exports = { now, parseCents, formatCents, toDateStr, dayDiff, daysSince };
