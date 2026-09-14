const store = require("../data/mockStore");

// Middle layer: validates request params, applies pagination,
// and wraps results in the standard response shape.

function paginate(items, query) {
  const page = query.page !== undefined ? parseInt(query.page) : 1;
  const pageSize = query.pageSize !== undefined
    ? Math.min(parseInt(query.pageSize), 100)
    : 25;

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    const err = new Error("page and pageSize must be positive numbers.");
    err.status = 400;
    throw err;
  }

  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return {
    data: paged,
    pagination: {
      page,
      pageSize,
      totalItems: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

function getCustomers(query) {
  return paginate(store.customers, query);
}
function getAccounts(query) { return paginate(store.accounts, query); }

function getInvoices(query) {
  return paginate(store.invoices, query);
}

function getPayments(query) {
  return paginate(store.payments, query);
}

module.exports = { getCustomers, getInvoices, getPayments, getAccounts };