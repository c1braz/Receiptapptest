// API client. Point API_BASE_URL at the backend:
//  - iOS simulator: http://localhost:4000
//  - physical device on same wifi: http://<your-mac-LAN-ip>:4000
//  - production: https://your-deployed-backend
export const API_BASE_URL = 'http://localhost:4000';

let authToken = null;
export function setAuthToken(token) { authToken = token; }

async function request(path, { method = 'GET', json, form, timeoutMs = 20000 } = {}) {
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form; // RN sets the multipart boundary itself

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body, signal: controller.signal });
  } catch (err) {
    throw new Error(err.name === 'AbortError'
      ? 'Request timed out — check your connection and try again.'
      : 'Could not reach the server. Are you online?');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', json: { email, password } }),
  me: () => request('/api/auth/me'),

  transactions: {
    list: (status) => request(`/api/transactions${status ? `?status=${status}` : ''}`),
    get: (id) => request(`/api/transactions/${id}`),
    assign: (id, userId) => request(`/api/transactions/${id}/assign`, { method: 'POST', json: { user_id: userId } }),
    confirmMatch: (id, receiptId) => request(`/api/transactions/${id}/confirm-match`, { method: 'POST', json: { receipt_id: receiptId } }),
    undoMatch: (id) => request(`/api/transactions/${id}/undo-match`, { method: 'POST' }),
    archive: (id) => request(`/api/transactions/${id}/archive`, { method: 'POST' }),
    unarchive: (id) => request(`/api/transactions/${id}/unarchive`, { method: 'POST' }),
    ignore: (id, reason) => request(`/api/transactions/${id}/ignore`, { method: 'POST', json: { reason } }),
    importCsv: (csv) => request('/api/transactions/import', { method: 'POST', json: { csv } }),
  },

  receipts: {
    list: (unmatched) => request(`/api/receipts${unmatched ? '?unmatched=1' : ''}`),
    formOptions: () => request('/api/receipts/form-options'),
    // imageAsset: { uri, mimeType, fileName } from expo-image-picker
    submit: (fields, imageAsset) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        if (v !== null && v !== undefined && v !== '') form.append(k, String(v));
      }
      form.append('image', {
        uri: imageAsset.uri,
        type: imageAsset.mimeType || 'image/jpeg',
        name: imageAsset.fileName || 'receipt.jpg',
      });
      return request('/api/receipts', { method: 'POST', form, timeoutMs: 60000 });
    },
    imageUrl: (id) => `${API_BASE_URL}/api/receipts/${id}/image`,
    imageHeaders: () => ({ Authorization: `Bearer ${authToken}` }),
  },

  users: {
    list: () => request('/api/users'),
    assignable: () => request('/api/users/assignable'),
    create: (payload) => request('/api/users', { method: 'POST', json: payload }),
    update: (id, payload) => request(`/api/users/${id}`, { method: 'PATCH', json: payload }),
  },

  settings: {
    get: () => request('/api/settings'),
    update: (payload) => request('/api/settings', { method: 'PUT', json: payload }),
    refreshJotformMap: () => request('/api/settings/jotform/refresh-map', { method: 'POST' }),
    syncJotform: () => request('/api/settings/jotform/sync', { method: 'POST' }),
  },

  dashboard: () => request('/api/dashboard'),
};

export function dollars(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
