const { test, after } = require('node:test');
const assert = require('node:assert');
try { require('dotenv').config(); } catch (e) {}
const { Pool } = require('pg');
const persistence = require('../src/persistence');

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const count = async (marker) =>
  (await pool.query('SELECT COUNT(*) FROM oauth_credentials WHERE platform = $1', [marker])).rows[0].count;

test('withTransaction rolls back when a step fails', { skip: !databaseUrl }, async () => {
  const marker = 'tx-fail-' + Date.now();
  await assert.rejects(
    () => persistence.withTransaction(async (client) => {
      await client.query('INSERT INTO oauth_credentials (platform) VALUES ($1)', [marker]);
      throw new Error('fail after insert');
    }),
    /fail after insert/
  );
  assert.equal(await count(marker), '0');
});

test('withTransaction commits when every step works', { skip: !databaseUrl }, async () => {
  const marker = 'tx-ok-' + Date.now();
  await persistence.withTransaction(async (client) => {
    await client.query('INSERT INTO oauth_credentials (platform) VALUES ($1)', [marker]);
  });
  assert.equal(await count(marker), '1');
  await pool.query('DELETE FROM oauth_credentials WHERE platform = $1', [marker]);
});

after(() => pool?.end());
