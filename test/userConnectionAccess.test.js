const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
require("dotenv").config();
const { Pool } = require("pg");
const persistence = require("../src/persistence");

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

after(async () => {
  if (pool) await pool.end();
});

test("bad ids are denied without touching the database", async () => {
  assert.equal(await persistence.hasUserConnectionAccess("nope", "nope"), false);
  assert.equal(await persistence.hasUserConnectionAccess(undefined, null), false);
  assert.deepEqual(await persistence.listConnectionsForUser("nope"), []);
});

test("grant, check, list and revoke connection access", { skip: !databaseUrl }, async () => {
  const client = await pool.connect();
  const addConnection = async (name) => (
    await client.query(
      `INSERT INTO connections (company_name, platform, status)
       VALUES ($1, 'xero', 'active')
       RETURNING *`,
      [name],
    )
  ).rows[0];

  try {
    // Rollback keeps real database verification isolated from development data.
    await client.query("BEGIN");
    const userId = randomUUID();
    await client.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
    const firstConnection = await addConnection("Access A");
    const secondConnection = await addConnection("Access B");

    assert.equal(
      await persistence.hasUserConnectionAccess(userId, firstConnection.connection_id, client),
      false,
    );
    assert.deepEqual(await persistence.listConnectionsForUser(userId, client), []);

    await persistence.grantUserConnectionAccess(userId, firstConnection.connection_id, client);
    await persistence.grantUserConnectionAccess(userId, firstConnection.connection_id, client);

    assert.equal(
      await persistence.hasUserConnectionAccess(userId, firstConnection.connection_id, client),
      true,
    );
    assert.equal(
      await persistence.hasUserConnectionAccess(userId, secondConnection.connection_id, client),
      false,
    );

    const rows = await persistence.listConnectionsForUser(userId, client);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].connection_id, firstConnection.connection_id);
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      Object.keys(firstConnection).sort(),
    );

    assert.deepEqual(
      await persistence.revokeUserConnectionAccess(userId, firstConnection.connection_id, client),
      { revoked: true },
    );
    assert.deepEqual(
      await persistence.revokeUserConnectionAccess(userId, firstConnection.connection_id, client),
      { revoked: false },
    );
    assert.equal(
      await persistence.hasUserConnectionAccess(userId, firstConnection.connection_id, client),
      false,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
