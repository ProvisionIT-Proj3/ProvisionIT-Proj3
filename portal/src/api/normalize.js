// the API can send db-style (snake_case) or canonical (camelCase) fields.
// anything that changes in the response shape gets fixed here only.

const pick = (obj, ...keys) => {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
};

const num = (value) => (value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value));

export const normalizeConnection = (r) => ({
  id: pick(r, 'id', 'connectionId', 'connection_id'),
  companyName: pick(r, 'companyName', 'company_name', 'displayName', 'name'),
  platform: pick(r, 'platform'),
  status: pick(r, 'status'),
  connectedAt: pick(r, 'dateConnected', 'date_connected', 'connectedAt'),
  lastSyncedAt: pick(r, 'lastSyncedAt', 'last_synced_at'),
});

export const normalizeInvoice = (r) => ({
  id: pick(r, 'id', 'invoiceId', 'invoice_id'),
  number: pick(r, 'invoiceNumber', 'number', 'sourceId', 'source_id', 'id', 'invoiceId', 'invoice_id'),
  customerId: pick(r, 'customerId', 'customer_id'),
  customerName: pick(r, 'customerName', 'customer_name'),
  total: num(pick(r, 'total', 'amount')),
  status: pick(r, 'status'),
  type: pick(r, 'type'),
  issueDate: pick(r, 'issueDate', 'issue_date'),
  dueDate: pick(r, 'dueDate', 'due_date'),
});

export const normalizePayment = (r) => ({
  id: pick(r, 'id', 'paymentId', 'payment_id'),
  invoiceId: pick(r, 'invoiceId', 'invoice_id'),
  amount: num(pick(r, 'amount', 'total')),
  method: pick(r, 'method'),
  status: pick(r, 'status'),
  date: pick(r, 'date', 'paymentDate', 'payment_date'),
});

export const normalizeCustomer = (r) => ({
  id: pick(r, 'id', 'customerId', 'customer_id'),
  name: pick(r, 'displayName', 'name'),
  email: pick(r, 'email'),
  phone: pick(r, 'phone'),
  status: pick(r, 'status'),
});

export const normalizeAccount = (r) => ({
  id: pick(r, 'id', 'sourceId', 'source_id', 'accountId', 'account_id'),
  code: pick(r, 'code'),
  name: pick(r, 'name'),
  type: pick(r, 'type'),
  drCr: pick(r, 'drCr', 'dr_cr'),
  isHeader: Boolean(pick(r, 'isHeader', 'is_header')),
  level: num(pick(r, 'level')) ?? 0,
  value: num(pick(r, 'value')),
  taxCode: pick(r, 'taxCode', 'tax_code'),
});

export const normalizeActivity = (r) => ({
  id: pick(r, 'id', 'auditId', 'audit_id'),
  occurredAt: pick(r, 'occurredAt', 'occurred_at'),
  action: pick(r, 'action'),
  outcome: pick(r, 'outcome'),
  errorCode: pick(r, 'errorCode', 'error_code'),
  provider: pick(r, 'provider'),
  connectionId: pick(r, 'connectionId', 'connection_id'),
  companyName: pick(r, 'companyName', 'company_name'),
  actorUserId: pick(r, 'actorUserId', 'actor_user_id'),
});
