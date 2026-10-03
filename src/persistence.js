// persistence.js
// Persistence layer — the ONLY place in the codebase that talks directly to the database.
// Lionel's middleware calls these functions instead of writing raw SQL.
// Owner: Giorgio (Person 5)

const { Pool } = require('pg');

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
    `INSERT INTO user_profiles (user_id, role)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [userId, role]
  );
  return result.rows[0];
}

// ---------- CUSTOMERS ----------

async function saveCustomer(connectionId, customer) {
  const result = await pool.query(
    `INSERT INTO customers (connection_id, source_id, name, email, phone, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (connection_id, source_id) DO UPDATE
       SET name = EXCLUDED.name, email = EXCLUDED.email,
           phone = EXCLUDED.phone, status = EXCLUDED.status, updated_at = now()
     RETURNING *`,
    [connectionId, customer.sourceId, customer.name, customer.email, customer.phone, customer.status || 'active']
  );
  return result.rows[0];
}

async function getCustomersByConnection(connectionId) {
  const result = await pool.query(
    `SELECT * FROM customers WHERE connection_id = $1 ORDER BY name`,
    [connectionId]
  );
  return result.rows;
}

// ---------- INVOICES ----------

async function saveInvoice(customerId, invoice) {
  const result = await pool.query(
    `INSERT INTO invoices (customer_id, source_id, amount, status, type, issue_date, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (customer_id, source_id) DO UPDATE
       SET amount = EXCLUDED.amount, status = EXCLUDED.status,
           type = EXCLUDED.type, due_date = EXCLUDED.due_date
     RETURNING *`,
    [customerId, invoice.sourceId, invoice.amount, invoice.status, invoice.type || 'sales_invoice', invoice.issueDate, invoice.dueDate]
  );
  return result.rows[0];
}

async function getInvoicesByConnection(connectionId, filters = {}) {
  const conditions = [`c.connection_id = $1`];
  const params = [connectionId];
  let i = 2;

  if (filters.status) {
    conditions.push(`i.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.search) {
    conditions.push(`c.name ILIKE $${i++}`);
    params.push(`%${filters.search}%`);
  }
  if (filters.fromDate) {
    conditions.push(`i.issue_date >= $${i++}`);
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    conditions.push(`i.issue_date <= $${i++}`);
    params.push(filters.toDate);
  }

  const page = filters.page || 1;
  const pageSize = Math.min(filters.pageSize || 25, 100);
  const offset = (page - 1) * pageSize;

  const query = `
    SELECT i.*, c.name AS customer_name
    FROM invoices i
    JOIN customers c ON c.customer_id = i.customer_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY i.issue_date DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  const countQuery = `
    SELECT COUNT(*) FROM invoices i
    JOIN customers c ON c.customer_id = i.customer_id
    WHERE ${conditions.join(' AND ')}
  `;

  const [rows, count] = await Promise.all([
    pool.query(query, params),
    pool.query(countQuery, params),
  ]);

  return {
    data: rows.rows,
    pagination: { page, pageSize, totalItems: parseInt(count.rows[0].count, 10) },
  };
}

// ---------- PAYMENTS ----------

async function savePayment(invoiceId, payment) {
  const result = await pool.query(
    `INSERT INTO payments (invoice_id, source_id, amount, payment_date, method, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (invoice_id, source_id) DO UPDATE
       SET amount = EXCLUDED.amount, status = EXCLUDED.status
     RETURNING *`,
    [invoiceId, payment.sourceId, payment.amount, payment.paymentDate, payment.method, payment.status || 'completed']
  );
  return result.rows[0];
}

async function getPaymentsByConnection(connectionId, filters = {}) {
  const page = filters.page || 1;
  const pageSize = Math.min(filters.pageSize || 25, 100);
  const offset = (page - 1) * pageSize;

  const result = await pool.query(
    `SELECT p.*, i.customer_id
     FROM payments p
     JOIN invoices i ON i.invoice_id = p.invoice_id
     JOIN customers c ON c.customer_id = i.customer_id
     WHERE c.connection_id = $1
     ORDER BY p.payment_date DESC
     LIMIT $2 OFFSET $3`,
    [connectionId, pageSize, offset]
  );
  return result.rows;
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

module.exports = {
  createConnection, getConnectionById, listConnections, deleteConnection,
  createCredential, updateCredentialTokens, linkConnectionToCredential, getTokensForConnection,
  getUserRole, setUserRole,
  saveCustomer, getCustomersByConnection,
  saveInvoice, getInvoicesByConnection,
  savePayment, getPaymentsByConnection,
  logActivity, getActivityLog,
};
