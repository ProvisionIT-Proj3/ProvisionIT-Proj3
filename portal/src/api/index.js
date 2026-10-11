import { get as httpGet, post as httpPost } from './http';
import { mockGet, mockPost } from './mock';
import { normalizeAccount, normalizeConnection, normalizeCustomer, normalizeInvoice, normalizePayment } from './normalize';
import { isSample } from './sample';

// checked on every call so tests can switch it
const get = (path, params) => (isSample(path) ? mockGet : httpGet)(path, params);
const post = (path, params) => (isSample(path) ? mockPost : httpPost)(path, params);

function toList(body, normalize) {
  const rows = Array.isArray(body) ? body : (body?.data ?? []);
  const items = rows.map(normalize);
  const p = body?.pagination ?? {};
  const pageSize = p.pageSize ?? (items.length || 1);
  const totalItems = p.totalItems ?? items.length;
  return {
    items,
    pagination: {
      page: p.page ?? 1,
      pageSize,
      totalItems,
      totalPages: p.totalPages ?? Math.max(1, Math.ceil(totalItems / pageSize)),
    },
  };
}

// the trial balance reply is a plain list of accounts, wrapped or not
function toRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['data', 'accounts', 'rows']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

export const api = {
  async listConnections() {
    return toList(await get('/connections'), normalizeConnection);
  },
  async listAccounts({ connectionId, page, pageSize }) {
    return toList(await get('/accounts', { connectionId, page, pageSize }), normalizeAccount);
  },
  async getTrialBalance(connectionId) {
    const rows = toRows(await get('/trial-balance', { connectionId }));
    return { items: rows.map(normalizeAccount), pagination: null };
  },
  // admin only on the server, pulls fresh accounts from Xero / QuickBooks and stores them
  async syncAccounts(connectionId) {
    return post('/sync', { connectionId });
  },
  async listInvoices({ connectionId, page, pageSize, status, search }) {
    return toList(await get('/invoices', { connectionId, page, pageSize, status, search }), normalizeInvoice);
  },
  async listPayments({ connectionId, page, pageSize }) {
    return toList(await get('/payments', { connectionId, page, pageSize }), normalizePayment);
  },
  async listCustomers({ connectionId, page, pageSize }) {
    return toList(await get('/customers', { connectionId, page, pageSize }), normalizeCustomer);
  },
};
