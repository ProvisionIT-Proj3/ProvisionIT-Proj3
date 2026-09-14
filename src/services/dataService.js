const persistence = require("../persistence"); // Giorgio's DB functions

// Middle layer: validates request params, applies pagination,
// and wraps results in the standard response shape.
// Now backed by the real database instead of mockStore.

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
  return query.connectionId;
}

// Converts snake_case DB rows to camelCase for the API response
function toCamelCase(row) {
  const out = {};
  for (const key in row) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camelKey] = row[key];
  }
  return out;
}

async function getCustomers(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);
  const rows = await persistence.getCustomersByConnection(connectionId);

  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize).map(toCamelCase);

  return {
    data: paged,
    pagination: {
      page,
      pageSize,
      totalItems: rows.length,
      totalPages: Math.ceil(rows.length / pageSize),
    },
  };
}

async function getInvoices(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);

  const result = await persistence.getInvoicesByConnection(connectionId, {
    status: query.status,
    search: query.search,
    fromDate: query.fromDate,
    toDate: query.toDate,
    page,
    pageSize,
  });

  return {
    data: result.data.map(toCamelCase),
    pagination: {
      ...result.pagination,
      totalPages: Math.ceil(result.pagination.totalItems / pageSize),
    },
  };
}
function getAccounts(query) { return paginate(store.accounts, query); }

async function getPayments(query) {
  const connectionId = requireConnectionId(query);
  const { page, pageSize } = validatePagination(query);
  const rows = await persistence.getPaymentsByConnection(connectionId, { page, pageSize });

  return {
    data: rows.map(toCamelCase),
    pagination: {
      page,
      pageSize,
      totalItems: rows.length, // NOTE: not a true total count yet — persistence layer would need a count query added, same pattern as getInvoicesByConnection
      totalPages: Math.ceil(rows.length / pageSize),
    },
  };
}

module.exports = { getCustomers, getInvoices, getPayments, getAccounts };