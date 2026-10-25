require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert');

// These tests write temporary rows, so they only run when a real DATABASE_URL
// is set (point it at a dev database). CI has none, so they are skipped there.
const HAS_DB = Boolean(process.env.DATABASE_URL);
const skip = HAS_DB ? false : 'DATABASE_URL is not set';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@localhost:5432/none';
const db = require('../src/persistence');

let connectionId;

test.before(async () => {
  if (!HAS_DB) return;
  const conn = await db.createConnection({
    companyName: 'Test Co',
    platform: 'xero',
    externalAccountId: 'test-tenant-1',
  });
  connectionId = conn.connection_id;
});

test.after(async () => {
  if (HAS_DB && connectionId) await db.deleteConnection(connectionId);
});

test('createConnection returns the new row', { skip }, async () => {
  const conn = await db.getConnectionById(connectionId);
  assert.strictEqual(conn.company_name, 'Test Co');
  assert.strictEqual(conn.status, 'active');
});

test('getConnectionById returns null for an unknown id', { skip }, async () => {
  const conn = await db.getConnectionById('00000000-0000-0000-0000-000000000000');
  assert.strictEqual(conn, null);
});

test('logActivity writes to the activity log', { skip }, async () => {
  await db.logActivity(connectionId, 'test_action', 'from the test suite');
  const log = await db.getActivityLog(connectionId);
  assert.strictEqual(log[0].action, 'test_action');
});

test('deleteConnection removes the connection', { skip }, async () => {
  const temp = await db.createConnection({ companyName: 'Temp Co', platform: 'quickbooks', externalAccountId: 'tmp' });
  await db.deleteConnection(temp.connection_id);
  assert.strictEqual(await db.getConnectionById(temp.connection_id), null);
});