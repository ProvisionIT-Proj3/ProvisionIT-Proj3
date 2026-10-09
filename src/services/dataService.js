const persistence = require("../persistence");
const { registry } = require("../auth");
const { createConnector } = require("../connector/connectorFactory");
const { toCanonicalList } = require("./canonicalMapper");
const { parsePagination } = require("./validation");

// Accounts are STORED, not fetched per request:
//
//   POST /sync      Xero/QuickBooks -> connector (+ mapper) -> saveAccounts -> DB
//   GET  /accounts  DB -> canonical mapper -> portal
//
// The trial balance is still fetched live (it is a point-in-time report).

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  err.code = "CONNECTION_NOT_FOUND";
  return err;
}

async function getConnector(connectionId) {
  const provider = await registry.resolveProvider(connectionId);
  if (!provider) throw notFound("Accounting connection not found.");
  return createConnector(provider);
}

// Casing only. Field renames and value normalisation happen in canonicalMapper.
function toCamelCase(row) {
  const out = {};
  for (const key in row) {
    out[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = row[key];
  }
  return out;
}

/**
 * Read the stored accounts for a connection, in report order, paginated.
 * Returns an empty list (with meta.lastSyncedAt = null) until a sync has run.
 */
async function getAccounts(connectionId, query = {}) {
  const { page, pageSize } = parsePagination(query);

  const connection = await persistence.getConnectionById(connectionId);
  if (!connection) throw notFound("Accounting connection not found.");

  // Already ordered by sort_order, so header rows sit above their detail rows.
  const rows = await persistence.getAccountsByConnection(connectionId);

  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize).map(toCamelCase);

  return {
    data: toCanonicalList("account", paged, { sourceSystem: connection.platform }),
    pagination: {
      page,
      pageSize,
      totalItems: rows.length,
      totalPages: Math.ceil(rows.length / pageSize),
    },
    meta: {
      lastSyncedAt: connection.last_synced_at ?? null,
      reportDate: rows.length ? rows[0].report_date : null,
    },
  };
}

/**
 * Fetch the live account report from the accounting system and replace the
 * stored snapshot for this connection.
 */
async function syncAccounts(connectionId) {
  const connector = await getConnector(connectionId);
  const accounts = await connector.getAccounts(connectionId);

  // The trial balance is requested "as of today", so that is the report date.
  const reportDate = new Date().toISOString().slice(0, 10);
  const { saved } = await persistence.saveAccounts(connectionId, accounts, reportDate);

  return { data: { saved, reportDate, syncedAt: new Date().toISOString() } };
}

async function getTrialBalance(connectionId) {
  const connector = await getConnector(connectionId);
  const trialBalance = await connector.getTrialBalance(connectionId);
  return { data: trialBalance };
}

module.exports = { getAccounts, syncAccounts, getTrialBalance };
