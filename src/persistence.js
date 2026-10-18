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

// A bounded audit pool prevents a logging outage from exhausting business connections.
const auditPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 2000,
  query_timeout: 2000,
});

// A shared client prevents partial OAuth records when any persistence step fails.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---------- CONNECTIONS ----------

async function createConnection({
  companyName,
  platform,
  externalConnectionId = null,
  externalAccountId,
  providerMetadata = {},
}, client = pool) {
  const result = await client.query(
    `INSERT INTO connections
       (company_name, platform, status, external_connection_id, external_account_id, provider_metadata)
     VALUES ($1, $2, 'active', $3, $4, $5)
     RETURNING *`,
    [companyName, platform, externalConnectionId, externalAccountId, providerMetadata]
  );
  return result.rows[0];
}

async function getConnectionById(connectionId, client = pool) {
  const result = await client.query(
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

async function createCredential({
  platform,
  accessToken = null,
  refreshToken = null,
  expiresAt = null,
  status = 'active',
}, client = pool) {
  const result = await client.query(
    `INSERT INTO oauth_credentials
       (platform, access_token, refresh_token, token_expires_at, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [platform, accessToken, refreshToken, expiresAt, status]
  );
  return result.rows[0];
}

// Refreshing updates ONE row here — every connection referencing this credential_id
// automatically sees the new token, no per-connection update loop needed.
async function updateCredentialTokens(
  credentialId,
  { accessToken, refreshToken, expiresAt, status = 'active' },
  client = pool
) {
  const result = await client.query(
    `UPDATE oauth_credentials
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         status = $4,
         updated_at = now()
     WHERE credential_id = $5
     RETURNING *`,
    [accessToken, refreshToken, expiresAt, status, credentialId]
  );
  return result.rows[0];
}

// The provider account ID is saved when the connection is created. Linking a
// credential must not be able to erase it during a later update.
async function linkConnectionToCredential(connectionId, credentialId, client = pool) {
  const result = await client.query(
    `UPDATE connections
     SET credential_id = $1
     WHERE connection_id = $2
     RETURNING connection_id, company_name, platform, status,
               external_connection_id, external_account_id, provider_metadata, credential_id`,
    [credentialId, connectionId]
  );
  return result.rows[0];
}

// Gets a connection's current tokens by following its credential_id
async function getTokensForConnection(connectionId, client = pool) {
  const result = await client.query(
    `SELECT oc.access_token,
            oc.refresh_token,
            oc.token_expires_at,
            oc.status AS credential_status
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

// Security audit writes use a strict event shape prepared by auditLogger.
// No update or delete operation is exposed so application code cannot rewrite history.
async function writeAuditEvent({
  auditId,
  occurredAt,
  actorUserId,
  connectionId,
  provider,
  action,
  outcome,
  errorCode,
  requestId,
  metadata,
}) {
  const result = await auditPool.query(
    `INSERT INTO security_audit_log
       (audit_id, occurred_at, actor_user_id, connection_id, provider, action,
        outcome, error_code, request_id, metadata)
     VALUES (COALESCE($10::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (audit_id) DO NOTHING
     RETURNING audit_id, occurred_at`,
    [
      occurredAt,
      actorUserId,
      connectionId,
      provider,
      action,
      outcome,
      errorCode,
      requestId,
      metadata,
      auditId,
    ]
  );
  return result.rows[0];
}

async function writeAuditEvents(events) {
  if (!events.length) return [];
  const result = await auditPool.query(
    `INSERT INTO security_audit_log
       (audit_id, occurred_at, actor_user_id, connection_id, provider, action,
        outcome, error_code, request_id, metadata)
     SELECT "auditId", "occurredAt", "actorUserId", "connectionId", provider,
            action, outcome, "errorCode", "requestId", metadata
     FROM jsonb_to_recordset($1::jsonb) AS event(
       "auditId" uuid, "occurredAt" timestamptz, "actorUserId" uuid,
       "connectionId" uuid, provider text, action text, outcome text,
       "errorCode" text, "requestId" text, metadata jsonb)
     WHERE true
     ON CONFLICT (audit_id) DO NOTHING
     RETURNING audit_id, occurred_at`,
    [JSON.stringify(events)],
  );
  return result.rows;
}

const accessUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hasUserConnectionAccess(userId, connectionId, client = pool) {
  if (!accessUuidPattern.test(String(userId)) || !accessUuidPattern.test(String(connectionId))) {
    return false;
  }
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_connection_access
       WHERE user_id = $1 AND connection_id = $2
     ) AS allowed`,
    [userId, connectionId]
  );
  return result.rows[0].allowed === true;
}

// Matching listConnections() keeps the route response independent of the caller's role.
async function listConnectionsForUser(userId, client = pool) {
  if (!accessUuidPattern.test(String(userId))) return [];
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

// Idempotent grants make retries safe after an uncertain network response.
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
  withTransaction,
  hasUserConnectionAccess, listConnectionsForUser,
  grantUserConnectionAccess, revokeUserConnectionAccess,
  createConnection, getConnectionById, listConnections, deleteConnection,
  createCredential, updateCredentialTokens, linkConnectionToCredential, getTokensForConnection,
  getUserRole, setUserRole,
  getAccountsByConnection, saveAccounts,
  logActivity, getActivityLog,
  writeAuditEvent,
  writeAuditEvents,
};
