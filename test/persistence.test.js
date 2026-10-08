require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/persistence');

let connectionId;
let customerId;

test.before(async () => {
  const conn = await db.createConnection({
    companyName: 'Test Co',
    platform: 'xero',
    externalAccountId: 'test-tenant-1',
  });
  connectionId = conn.connection_id;
});

// deleting the connection cascades to customers/invoices/payments
test.after(async () => {
  await db.deleteConnection(connectionId);
});

test('createConnection returns the new row', async () => {
  const conn = await db.getConnectionById(connectionId);
  assert.strictEqual(conn.company_name, 'Test Co');
  assert.strictEqual(conn.status, 'active');
});

test('getConnectionById returns null for an unknown id', async () => {
  const conn = await db.getConnectionById('00000000-0000-0000-0000-000000000000');
  assert.strictEqual(conn, null);
});

test('saveCustomer inserts a customer', async () => {
  const c = await db.saveCustomer(connectionId, {
    sourceId: 'C1', name: 'Acme Pty Ltd', email: 'a@acme.com', phone: null,
  });
  customerId = c.customer_id;
  assert.strictEqual(c.name, 'Acme Pty Ltd');
});

test('saveCustomer with the same sourceId updates instead of duplicating', async () => {
  await db.saveCustomer(connectionId, { sourceId: 'C1', name: 'Acme Renamed', email: 'a@acme.com', phone: null });
  const rows = await db.getCustomersByConnection(connectionId);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].name, 'Acme Renamed');
});

test('saveInvoice defaults type to sales_invoice', async () => {
  const inv = await db.saveInvoice(customerId, {
    sourceId: 'INV1', amount: 540, status: 'overdue', issueDate: '2026-08-10', dueDate: '2026-08-18',
  });
  assert.strictEqual(inv.type, 'sales_invoice');
  assert.strictEqual(Number(inv.amount), 540);
});

test('getInvoicesByConnection filters by status', async () => {
  await db.saveInvoice(customerId, {
    sourceId: 'INV2', amount: 100, status: 'paid', issueDate: '2026-08-12', dueDate: '2026-08-20',
  });
  const res = await db.getInvoicesByConnection(connectionId, { status: 'paid' });
  assert.strictEqual(res.data.length, 1);
  assert.strictEqual(res.data[0].status, 'paid');
});

test('getInvoicesByConnection search matches customer name', async () => {
  const hit = await db.getInvoicesByConnection(connectionId, { search: 'renamed' });
  const miss = await db.getInvoicesByConnection(connectionId, { search: 'nobody' });
  assert.strictEqual(hit.data.length, 2);
  assert.strictEqual(miss.data.length, 0);
});

test('getInvoicesByConnection paginates', async () => {
  const res = await db.getInvoicesByConnection(connectionId, { page: 1, pageSize: 1 });
  assert.strictEqual(res.data.length, 1);
  assert.strictEqual(res.pagination.totalItems, 2);
});

test('savePayment links to an invoice and shows up in the connection query', async () => {
  const invoices = await db.getInvoicesByConnection(connectionId, { status: 'paid' });
  await db.savePayment(invoices.data[0].invoice_id, {
    sourceId: 'P1', amount: 100, paymentDate: '2026-08-19', method: 'bank_transfer',
  });
  const payments = await db.getPaymentsByConnection(connectionId);
  assert.strictEqual(payments.length, 1);
});

test('logActivity writes to the activity log', async () => {
  await db.logActivity(connectionId, 'test_action', 'from the test suite');
  const log = await db.getActivityLog(connectionId);
  assert.strictEqual(log[0].action, 'test_action');
});

test('deleteConnection cascades to customers', async () => {
  const temp = await db.createConnection({ companyName: 'Temp Co', platform: 'myob', externalAccountId: 'tmp' });
  await db.saveCustomer(temp.connection_id, { sourceId: 'X1', name: 'Gone Soon', email: null, phone: null });
  await db.deleteConnection(temp.connection_id);
  const rows = await db.getCustomersByConnection(temp.connection_id);
  assert.strictEqual(rows.length, 0);
});
