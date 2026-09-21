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

async function createConnection({ companyName, platform }) {
  const result = await pool.query(
    `INSERT INTO connections (company_name, platform, status)
     VALUES ($1, $2, 'active')
     RETURNING *`,
    [companyName, platform]
  );
  return result.rows[0];
}

async function saveTokens(connectionId, { accessToken, refreshToken, expiresAt }) {
  const result = await pool.query(
    `UPDATE connections
     SET access_token = $1, refresh_token = $2, token_expires_at = $3
     WHERE connection_id = $4
     RETURNING connection_id, company_name, platform, status, token_expires_at`,
    [accessToken, refreshToken, expiresAt, connectionId]
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
  // Cascades to customers/invoices/payments via FK constraints; activity_log keeps its rows (SET NULL)
  await pool.query(`DELETE FROM connections WHERE connection_id = $1`, [connectionId]);
  return { deleted: true };
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

// Main function the REST API's GET /invoices endpoint will call
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

  // customer_source_id added: invoices.customer_id is our internal PK, but the
  // canonical Invoice.customerId must reference the vendor-native Customer.id
  // (customers.source_id). Additive only — existing callers are unaffected.
  const query = `
    SELECT i.*, c.name AS customer_name, c.source_id AS customer_source_id
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

  // i.type added so the middleware can derive canonical Payment.direction
  // (sales invoice -> receivable, bill -> payable).
  // c.source_id added so canonical Payment.partyId references the vendor-native
  // Customer.id rather than our internal PK. Both additive.
  const result = await pool.query(
    `SELECT p.*, i.customer_id, i.type, c.source_id AS customer_source_id
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
  createConnection, saveTokens, getConnectionById, listConnections, deleteConnection,
  saveCustomer, getCustomersByConnection,
  saveInvoice, getInvoicesByConnection,
  savePayment, getPaymentsByConnection,
  logActivity, getActivityLog,
};