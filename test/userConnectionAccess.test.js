const { test, after } = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
try { require('dotenv').config(); } catch (e) {}
const { Pool } = require('pg');
const persistence = require('../src/persistence');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());

test('bad ids are denied without touching the database', async () => {
  assert.strictEqual(await persistence.hasUserConnectionAccess('nope', 'nope'), false);
  assert.strictEqual(await persistence.hasUserConnectionAccess(undefined, null), false);
  assert.deepStrictEqual(await persistence.listConnectionsForUser('nope'), []);
});

// runs in a transaction that is rolled back at the end, so no test rows are left behind
test('grant, check, list and revoke connection access', async () => {
  const client = await pool.connect();
  const addConnection = async (name) =>
    (await client.query(
      `INSERT INTO connections (company_name, platform, status) VALUES ($1, 'xero', 'active') RETURNING *`,
      [name]
    )).rows[0];

  try {
    await client.query('BEGIN');
    const userId = randomUUID();
    await client.query('INSERT INTO auth.users (id) VALUES ($1)', [userId]);
    const a = await addConnection('Access A');
    const b = await addConnection('Access B');

    assert.strictEqual(await persistence.hasUserConnectionAccess(userId, a.connection_id, client), false);
    assert.deepStrictEqual(await persistence.listConnectionsForUser(userId, client), []);

    await persistence.grantUserConnectionAccess(userId, a.connection_id, client);
    await persistence.grantUserConnectionAccess(userId, a.connection_id, client); // twice is fine

    assert.strictEqual(await persistence.hasUserConnectionAccess(userId, a.connection_id, client), true);
    assert.strictEqual(await persistence.hasUserConnectionAccess(userId, b.connection_id, client), false);

    const rows = await persistence.listConnectionsForUser(userId, client);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].connection_id, a.connection_id);
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), Object.keys(a).sort());

    assert.deepStrictEqual(await persistence.revokeUserConnectionAccess(userId, a.connection_id, client), { revoked: true });
    assert.deepStrictEqual(await persistence.revokeUserConnectionAccess(userId, a.connection_id, client), { revoked: false });
    assert.strictEqual(await persistence.hasUserConnectionAccess(userId, a.connection_id, client), false);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
