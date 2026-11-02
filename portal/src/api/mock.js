import { ApiError } from './http';

const wait = () => new Promise((r) => setTimeout(r, import.meta.env.MODE === 'test' ? 0 : 300));

const connections = [
  { connection_id: 'c1', company_name: 'Riverbend Cafe', platform: 'xero', status: 'active', date_connected: '2026-08-12T09:00:00Z', last_synced_at: '2026-10-07T04:10:00Z' },
  { connection_id: 'c2', company_name: 'Plumb Co', platform: 'myob', status: 'token_expired', date_connected: '2026-07-03T09:00:00Z', last_synced_at: null },
  { connection_id: 'c3', company_name: 'Northside Retail', platform: 'xero', status: 'active', date_connected: '2026-06-28T09:00:00Z', last_synced_at: '2026-10-08T01:40:00Z' },
];

const names = ['Acme Pty Ltd', 'Beta Traders', 'Coastal Supplies', 'Delta Works'];
const statuses = ['paid', 'overdue', 'awaiting_payment', 'draft'];
const day = (n) => `2026-09-${String(n).padStart(2, '0')}`;

const customers = connections.flatMap((c, ci) =>
  names.map((name, i) => ({
    id: `cust_${ci}_${i}`,
    connectionId: c.connection_id,
    displayName: name,
    email: `accounts@${name.split(' ')[0].toLowerCase()}.com.au`,
    status: 'active',
  })),
);

const invoices = connections.flatMap((c, ci) =>
  Array.from({ length: 12 }, (_, i) => ({
    id: `INV-${1000 + ci * 100 + i}`,
    connectionId: c.connection_id,
    customerId: `cust_${ci}_${i % 4}`,
    customerName: names[i % 4],
    status: statuses[i % 4],
    total: 100 + i * 37.5,
    issueDate: day(1 + i),
    dueDate: day(15 + i),
  })),
);

const payments = invoices
  .filter((inv) => inv.status === 'paid')
  .map((inv, i) => ({
    id: `PAY-${inv.id.slice(4)}`,
    connectionId: inv.connectionId,
    invoiceId: inv.id,
    amount: inv.total,
    method: i % 2 ? 'Card' : 'Bank transfer',
    date: inv.dueDate,
  }));

// a small chart of accounts, scaled per company so each one looks different
const accountsFor = (k) => [
  { id: 'a0', code: '', name: 'Assets', type: 'Asset', dr_cr: 'Dr', is_header: true, level: 0, value: null },
  { id: 'a1', code: '1000', name: 'Cheque Account', type: 'Bank', dr_cr: 'Dr', is_header: false, level: 1, value: 12450.8 * k },
  { id: 'a2', code: '1100', name: 'Accounts Receivable', type: 'Current Asset', dr_cr: 'Dr', is_header: false, level: 1, value: 4310.25 * k },
  { id: 'a3', code: '1500', name: 'Equipment', type: 'Fixed Asset', dr_cr: 'Dr', is_header: false, level: 1, value: 8200 * k },
  { id: 'a4', code: '', name: 'Liabilities', type: 'Liability', dr_cr: 'Cr', is_header: true, level: 0, value: null },
  { id: 'a5', code: '2000', name: 'Accounts Payable', type: 'Current Liability', dr_cr: 'Cr', is_header: false, level: 1, value: 3120.4 * k },
  { id: 'a6', code: '2200', name: 'GST', type: 'Current Liability', dr_cr: 'Cr', is_header: false, level: 1, value: 980.55 * k },
  { id: 'a7', code: '', name: 'Revenue', type: 'Revenue', dr_cr: 'Cr', is_header: true, level: 0, value: null },
  { id: 'a8', code: '4000', name: 'Sales', type: 'Revenue', dr_cr: 'Cr', is_header: false, level: 1, value: 21800 * k },
];

// newest first, like the real log
const activity = [
  ['sync.completed', 'success', 'Northside Retail', 'xero'],
  ['sync.completed', 'success', 'Riverbend Cafe', 'xero'],
  ['sync.failed', 'failure', 'Plumb Co', 'myob', 'XERO_REAUTHORIZATION_REQUIRED'],
  ['connection.reauthorization_required', 'success', 'Plumb Co', 'myob'],
  ['token.refreshed', 'success', 'Northside Retail', 'xero'],
  ['connection.created', 'success', 'Northside Retail', 'xero'],
  ['oauth.completed', 'success', null, 'xero'],
  ['oauth.failed', 'failure', null, 'xero', 'INVALID_OAUTH_STATE'],
  ['connection.disconnected', 'success', 'Old Test Co', 'quickbooks'],
  ['authorization.denied', 'denied', null, null, 'INSUFFICIENT_PERMISSION'],
  ['sync.completed', 'success', 'Riverbend Cafe', 'xero'],
  ['connection.created', 'success', 'Riverbend Cafe', 'xero'],
].map(([action, outcome, companyName, provider, errorCode = null], i) => ({
  id: `log${i}`,
  occurredAt: new Date(Date.UTC(2026, 9, 8, 6, 0) - i * 3.5 * 3600 * 1000).toISOString(),
  action,
  outcome,
  errorCode,
  provider,
  companyName,
  actorUserId: i % 3 === 2 ? null : 'sample-admin-0001',
}));

// the pages the API can't serve yet get a company even when the id is a real one
const SAMPLE_PAGES = ['/invoices', '/payments', '/customers'];
const pickSample = (id) => connections[[...String(id)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % connections.length];

export async function mockPost(path, params = {}) {
  await wait();
  if (path !== '/sync') throw new ApiError('Not found', 404, 'NOT_FOUND');
  if (!params.connectionId) throw new ApiError('connectionId is required.', 400, 'INVALID_PARAMETER');
  return { saved: accountsFor(1).length };
}

export async function mockGet(path, params = {}) {
  await wait();
  if (path === '/connections') return { data: connections };
  if (path === '/activity') {
    const page = Number(params.page) || 1;
    const pageSize = Number(params.pageSize) || 20;
    return {
      data: activity.slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, totalItems: activity.length, totalPages: Math.max(1, Math.ceil(activity.length / pageSize)) },
    };
  }

  if (!params.connectionId) throw new ApiError('connectionId is required.', 400, 'INVALID_PARAMETER');
  let company = connections.find((c) => c.connection_id === params.connectionId);
  if (!company && SAMPLE_PAGES.includes(path)) company = pickSample(params.connectionId);
  if (!company) throw new ApiError('Company not found.', 404, 'NOT_FOUND');
  params = { ...params, connectionId: company.connection_id };

  if (path === '/trial-balance') return { data: accountsFor(connections.indexOf(company) + 1) };

  let rows;
  if (path === '/invoices') {
    rows = invoices.filter((r) => r.connectionId === params.connectionId);
    if (params.status) rows = rows.filter((r) => r.status === params.status);
    if (params.search) rows = rows.filter((r) => r.customerName.toLowerCase().includes(String(params.search).toLowerCase()));
  } else if (path === '/payments') {
    rows = payments.filter((r) => r.connectionId === params.connectionId);
  } else if (path === '/customers') {
    rows = customers.filter((r) => r.connectionId === params.connectionId);
  } else if (path === '/accounts') {
    rows = accountsFor(connections.indexOf(company) + 1);
  } else {
    throw new ApiError('Not found', 404, 'NOT_FOUND');
  }

  const page = Number(params.page) || 1;
  const pageSize = Number(params.pageSize) || 25;
  const start = (page - 1) * pageSize;
  return {
    data: rows.slice(start, start + pageSize),
    pagination: { page, pageSize, totalItems: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / pageSize)) },
  };
}
