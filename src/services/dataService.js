const persistence = require("../persistence"); // Giorgio's DB functions
const { toCanonicalList, deriveDirection } = require("./canonicalMapper");

// Middle layer: validates request params, handles pagination, converts DB rows
// to Chris's canonical schema, and wraps results in the standard response shape.
//
// Pagination is NOT uniform across the persistence layer, so each function
// below matches what its query actually does:
//   getCustomersByConnection  returns all rows      -> paginate here
//   getInvoicesByConnection   LIMIT/OFFSET + COUNT  -> trust its pagination
//   getPaymentsByConnection   LIMIT/OFFSET, no count -> do NOT slice again

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validatePagination(query) {
  const page = query.page !== undefined ? parseInt(query.page) : 1;
  const pageSize = query.pageSize !== undefined
    ? Math.min(parseInt(query.pageSize), 100)
    : 25;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    const err = new Error("page and pageSize must be positive numbers.");
    err.status = 400;
    throw err;
  }
  return { page, pageSize };
}

function requireConnectionId(query) {
  // TEMP: using a query param until the team confirms path vs query param
  // for company/tenant scoping (see API design doc, open item 1).
  if (!query.connectionId) {
    const err = new Error("connectionId is required.");
    err.status = 400;
    throw err;
  }
  // connection_id is a uuid column. Reject malformed ids here, before the
  // database does, so the caller gets a 400 instead of a 500.
  if (!UUID_RE.test(query.connectionId)) {
    const err = new Error("connectionId must be a valid UUID.");
    err.status = 400;
    throw err;
  }
  return query.connectionId;
}

// Casing only. Canonical field renames and value normalisation happen in
// canonicalMapper, which reuses Chris's src/canonical/utils.js helpers.
function toCamelCase(row) {
  const out = {};
  for (const key in row) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camelKey] = row[key];
  }
  return out;
}

function buildPagination(page, pageSize, totalItems) {
  return { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) };
}

// Clear 501 instead of "persistence.x is not a function" when a data source
// has not been built yet.
function requirePersistence(fnName) {
  if (typeof persistence[fnName] !== "function") {
    const err = new Error(`Data source not available: persistence.${fnName} is not implemented.`);
    err.status = 501;
    throw err;
  }
  return persistence[fnName];
}

// Canonical sourceSystem is required on every entity, but the entity tables
// don't carry it. It lives on connections.platform, so fetch it once per
// request and stamp it on. Remove this if the SELECTs start joining it in.
async function resolveSourceSystem(connectionId) {
  const connection = await requirePersistence("getConnectionById")(connectionId);
  if (!connection) {
    const err = new Error(`Unknown connectionId: ${connectionId}`);
    err.status = 404;
    throw err;
  }
  return { sourceSystem: connection.platform };
}

async function getCustomers(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);

  const extra = await resolveSourceSystem(connectionId);
  const rows = await requirePersistence("getCustomersByConnection")(connectionId);

  // This query returns every row, so paginate in the service layer.
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize).map(toCamelCase);

  return {
    data: toCanonicalList("customer", paged, extra),
    pagination: buildPagination(page, pageSize, rows.length),
  };
}

async function getInvoices(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);

  const extra = await resolveSourceSystem(connectionId);
  const result = await requirePersistence("getInvoicesByConnection")(connectionId, {
    status: query.status,
    search: query.search,
    fromDate: query.fromDate,
    toDate: query.toDate,
    page,
    pageSize,
  });

  // Already paginated in SQL, with a real COUNT. Do not slice again.
  return {
    data: toCanonicalList("invoice", result.data.map(toCamelCase), extra),
    pagination: buildPagination(page, pageSize, result.pagination.totalItems),
  };
}

async function getPayments(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);

  const extra = await resolveSourceSystem(connectionId);
  const rows = await requirePersistence("getPaymentsByConnection")(connectionId, { page, pageSize });

  // Already LIMIT/OFFSET in SQL, so these are page rows, not all rows.
  const mapped = rows.map((row) => {
    // `type` is the settled invoice's type, selected only to derive canonical
    // Payment.direction. Pull it out so it doesn't appear on the payment.
    const { type, ...camel } = toCamelCase(row);
    return { ...camel, direction: deriveDirection(type) };
  });

  return {
    data: toCanonicalList("payment", mapped, extra),
    // totalItems is the page length, not a true total: this query has no
    // COUNT, unlike getInvoicesByConnection.
    pagination: buildPagination(page, pageSize, rows.length),
  };
}

async function getAccounts(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);

  // Accounts are NOT a stored entity like customers/invoices/payments. Chris's
  // buildXeroAccounts() assembles them from two Xero calls (GET /Accounts for
  // dimension data, GET /Reports/TrialBalance for balances and hierarchy), and
  // header rows are synthesised per report section.
  //
  // So this endpoint has no data source yet: the team still needs to decide
  // whether the assembled report is persisted (and read here like the others)
  // or requested from the connector on demand. Until that lands, 501.
  //
  // Availability is checked before any DB call so the 501 is what surfaces,
  // rather than a connection error from resolveSourceSystem.
  const getAccountsByConnection = requirePersistence("getAccountsByConnection");
  const extra = await resolveSourceSystem(connectionId);
  const rows = await getAccountsByConnection(connectionId);

  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize).map(toCamelCase);

  return {
    data: toCanonicalList("account", paged, extra),
    pagination: buildPagination(page, pageSize, rows.length),
  };
}

module.exports = { getCustomers, getInvoices, getPayments, getAccounts };