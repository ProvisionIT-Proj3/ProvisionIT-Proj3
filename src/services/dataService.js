const persistence = require("../persistence");
const { registry } = require("../auth");
const { createConnector } = require("../connector/connectorFactory");
const { toCanonicalList, assertStorable } = require("./canonicalMapper");
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

// Connectors read the as-of date off the report itself, so it is the
// company's date, not the server's. Today's UTC date is only a fallback for a
// connector or report that doesn't provide one.
async function fetchAccountsReport(connector, connectionId) {
  const todayUtc = () => new Date().toISOString().slice(0, 10);

  if (typeof connector.getAccountsReport === "function") {
    const { accounts, reportDate } = await connector.getAccountsReport(connectionId);
    return { accounts, reportDate: reportDate || todayUtc() };
  }

  return { accounts: await connector.getAccounts(connectionId), reportDate: todayUtc() };
}

/**
 * Fetch the live account report from the accounting system and replace the
 * stored snapshot for this connection.
 */
async function syncAccounts(connectionId) {
  const connector = await getConnector(connectionId);
  const { accounts, reportDate } = await fetchAccountsReport(connector, connectionId);

  // Storing replaces the whole snapshot, so an empty report must not wipe it.
  if (accounts.length === 0) {
    const err = new Error("The accounting system returned no accounts, so the stored accounts were left unchanged.");
    err.status = 502;
    err.code = "EMPTY_REPORT";
    throw err;
  }

  assertStorable("account", accounts);
  const { saved } = await persistence.saveAccounts(connectionId, accounts, reportDate);

  return { data: { saved, reportDate, syncedAt: new Date().toISOString() } };
}

// Live trial balance in the same canonical shape as GET /accounts (a flat list
// of header + detail rows), so every client reads it the same way. The raw
// vendor report is not returned: it is a nested object that differs per platform.
async function getTrialBalance(connectionId) {
  const connector = await getConnector(connectionId);
  const { accounts, reportDate } = await fetchAccountsReport(connector, connectionId);
  // _vendorSpecific is mapper-internal detail, not part of the canonical shape.
  const data = accounts.map(({ _vendorSpecific, ...account }) => account);
  return { data, meta: { live: true, reportDate, fetchedAt: new Date().toISOString() } };
}

module.exports = { getAccounts, syncAccounts, getTrialBalance };
