// persistence.js
// Persistence layer — the ONLY place in the codebase that talks directly to the database.
// Lionel's middleware calls these functions instead of writing raw SQL.
// Owner: Giorgio (Person 5)

const { Pool, types } = require('pg');

// Return Postgres DATE columns (type oid 1082) as plain 'YYYY-MM-DD' strings.
// By default pg parses them to a JS Date at local midnight, which shifts them
// back a day when converted to UTC in a timezone ahead of UTC (e.g. Melbourne).
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Supabase connection string, kept in .env — never hardcoded
});

// ---------- CONNECTIONS ----------

async function createConnection({ companyName, platform, externalAccountId }) {
  const result = await pool.query(
    `INSERT INTO connections (company_name, platform, status, external_account_id)
     VALUES ($1, $2, 'active', $3)
     RETURNING *`,
    [companyName, platform, externalAccountId]
  );
  return result.rows[0];
}

async function getConnectionById(connectionId) {
  const result = await pool.query(
    `SELECT * FROM connections WHERE connection_id = $1`,
    [connectionId]
  );
  return result.rows[0] || null;
}

async function listConnections() {
  const result = await pool.query(`SELECT * FROM connections ORDER BY date_connected DESC`);
  return result.rows;
}

async function deleteConnection(connectionId) {
  await pool.query(`DELETE FROM connections WHERE connection_id = $1`, [connectionId]);
  return { deleted: true };
}

// ---------- OAUTH CREDENTIALS ----------
// Tokens live here, not on `connections`, because one Xero OAuth grant can cover
// multiple organisations sharing the same rotating tokens (Yihan's multi-provider point).

async function createCredential({ platform, accessToken, refreshToken, expiresAt }) {
  const result = await pool.query(
    `INSERT INTO oauth_credentials (platform, access_token, refresh_token, token_expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [platform, accessToken, refreshToken, expiresAt]
  );
  return result.rows[0];
}

// Refreshing updates ONE row here — every connection referencing this credential_id
// automatically sees the new token, no per-connection update loop needed.
async function updateCredentialTokens(credentialId, { accessToken, refreshToken, expiresAt }) {
  const result = await pool.query(
    `UPDATE oauth_credentials
     SET access_token = $1, refresh_token = $2, token_expires_at = $3
     WHERE credential_id = $4
     RETURNING *`,
    [accessToken, refreshToken, expiresAt, credentialId]
  );
  return result.rows[0];
}

// Links a connection (one company/tenant) to a shared credential
async function linkConnectionToCredential(connectionId, credentialId, externalAccountId) {
  const result = await pool.query(
    `UPDATE connections
     SET credential_id = $1, external_account_id = $2
     WHERE connection_id = $3
     RETURNING connection_id, company_name, platform, status, external_account_id, credential_id`,
    [credentialId, externalAccountId, connectionId]
  );
  return result.rows[0];
}

// Gets a connection's current tokens by following its credential_id
async function getTokensForConnection(connectionId) {
  const result = await pool.query(
    `SELECT oc.access_token, oc.refresh_token, oc.token_expires_at
     FROM connections c
     JOIN oauth_credentials oc ON oc.credential_id = c.credential_id
     WHERE c.connection_id = $1`,
    [connectionId]
  );
  return result.rows[0] || null;
}

// ---------- USER ROLES ----------

async function getUserRole(userId) {
  const result = await pool.query(
    `SELECT role FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0]?.role || null; // null = no profile yet
}

async function setUserRole(userId, role) {
  const result = await pool.query(
    `INSERT INTO user_profiles (user_id, role, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET role = EXCLUDED.role, updated_at = now()
     RETURNING *`,
    [userId, role]
  );
  return result.rows[0];
}

// ---------- ACCOUNTS ----------

// Accounts are stored as the assembled report (header rows + detail rows), so
// ORDER BY sort_order is required to return them in report sequence.
async function getAccountsByConnection(connectionId) {
  const result = await pool.query(
    `SELECT * FROM accounts WHERE connection_id = $1 ORDER BY sort_order`,
    [connectionId]
  );
  return result.rows;
}

// Stores the full account list for one connection, as produced by the
// connector's mapper (canonical shape, already in report order).
//
// Accounts are a report snapshot, not independent records: accounts can be
// renamed, archived or disappear between syncs. So this REPLACES the stored
// snapshot for the connection rather than upserting row by row, inside a
// transaction so readers never see a half-written report.
//
// sort_order is taken from array position, which is how report order
// (header row, then its detail rows) survives storage.
//
// Also stamps connections.last_synced_at, which the admin portal displays.
//
// @param {string} connectionId
// @param {object[]} accounts  canonical Account objects in report order
// @param {string} [reportDate] as-of date of the trial balance, 'YYYY-MM-DD'
// @returns {{ saved: number }}
async function saveAccounts(connectionId, accounts, reportDate = null) {
  if (!Array.isArray(accounts)) {
    throw new Error('saveAccounts expects an array of canonical accounts');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM accounts WHERE connection_id = $1`, [connectionId]);

    if (accounts.length > 0) {
      const COLS = 12;
      const params = [];
      const rows = accounts.map((a, i) => {
        params.push(
          connectionId,
          a.id,
          a.code ?? null,
          a.name,
          a.type ?? null,
          a.drCr ?? null,
          Boolean(a.isHeader),
          a.level,
          a.value ?? null,
          a.taxCode ?? null,
          i + 1,
          reportDate
        );
        const base = i * COLS;
        return `(${Array.from({ length: COLS }, (_, c) => `$${base + c + 1}`).join(', ')})`;
      });

      await client.query(
        `INSERT INTO accounts
           (connection_id, source_id, code, name, type, dr_cr, is_header, level,
            value, tax_code, sort_order, report_date)
         VALUES ${rows.join(',\n                ')}`,
        params
      );
    }

    await client.query(
      `UPDATE connections SET last_synced_at = now() WHERE connection_id = $1`,
      [connectionId]
    );

    await client.query('COMMIT');
    return { saved: accounts.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- ACTIVITY LOG ----------

async function logActivity(connectionId, action, details = null) {
  await pool.query(
    `INSERT INTO activity_log (connection_id, action, details) VALUES ($1, $2, $3)`,
    [connectionId, action, details]
  );
}

async function getActivityLog(connectionId, limit = 50) {
  const result = await pool.query(
    `SELECT * FROM activity_log WHERE connection_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [connectionId, limit]
  );
  return result.rows;
}

// which companies a normal user can see
const ACCESS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hasUserConnectionAccess(userId, connectionId, client = pool) {
  if (!ACCESS_UUID_RE.test(String(userId)) || !ACCESS_UUID_RE.test(String(connectionId))) return false;
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_connection_access
       WHERE user_id = $1 AND connection_id = $2
     ) AS allowed`,
    [userId, connectionId]
  );
  return result.rows[0].allowed === true;
}

// same columns as listConnections(), only the user's companies
async function listConnectionsForUser(userId, client = pool) {
  if (!ACCESS_UUID_RE.test(String(userId))) return [];
  const result = await client.query(
    `SELECT c.*
     FROM connections c
     JOIN user_connection_access a ON a.connection_id = c.connection_id
     WHERE a.user_id = $1
     ORDER BY c.date_connected DESC`,
    [userId]
  );
  return result.rows;
}

// granting twice is fine
async function grantUserConnectionAccess(userId, connectionId, client = pool) {
  const result = await client.query(
    `INSERT INTO user_connection_access (user_id, connection_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, connection_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, connectionId]
  );
  return result.rows[0];
}

async function revokeUserConnectionAccess(userId, connectionId, client = pool) {
  const result = await client.query(
    `DELETE FROM user_connection_access WHERE user_id = $1 AND connection_id = $2`,
    [userId, connectionId]
  );
  return { revoked: result.rowCount > 0 };
}

module.exports = {
  hasUserConnectionAccess, listConnectionsForUser,
  grantUserConnectionAccess, revokeUserConnectionAccess,
  createConnection, getConnectionById, listConnections, deleteConnection,
  createCredential, updateCredentialTokens, linkConnectionToCredential, getTokensForConnection,
  getUserRole, setUserRole,
  getAccountsByConnection, saveAccounts,
  logActivity, getActivityLog,
};
