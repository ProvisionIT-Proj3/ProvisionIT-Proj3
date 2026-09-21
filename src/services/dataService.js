const { getContacts } = require("../connector/xero/contacts");
const { getInvoices: getXeroInvoices } = require("../connector/xero/invoices");
const { getPayments: getXeroPayments } = require("../connector/xero/payments");
const { getAccounts: getXeroAccounts } = require("../connector/xero/accounts");

// Middle layer: validates request params and wraps results
// in the standard response shape.

function getPagination(query) {
  const page = query.page !== undefined
    ? parseInt(query.page, 10)
    : 1;

  const pageSize = query.pageSize !== undefined
    ? Math.min(parseInt(query.pageSize, 10), 100)
    : 25;

  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1
  ) {
    const err = new Error(
      "page and pageSize must be positive numbers."
    );

    err.status = 400;
    err.code = "INVALID_PARAMETER";
    throw err;
  }

  return { page, pageSize };
}

function wrapResult(items, page, pageSize) {
  return {
    data: items,
    pagination: {
      page,
      pageSize,
      totalItems: items.length,
    },
  };
}

async function getCustomers(connectionId, query = {}) {
  const { page, pageSize } = getPagination(query);

  const contacts = await getContacts(connectionId, {
    page,
    pageSize,
  });

  return wrapResult(contacts, page, pageSize);
}

async function getInvoices(connectionId, query = {}) {
  const { page, pageSize } = getPagination(query);

  const invoices = await getXeroInvoices(connectionId, {
    page,
    pageSize,
  });

  return wrapResult(invoices, page, pageSize);
}

async function getPayments(connectionId, query = {}) {
  const { page, pageSize } = getPagination(query);

  const payments = await getXeroPayments(connectionId, {
    page,
    pageSize,
  });

  return wrapResult(payments, page, pageSize);
}

async function getAccounts(connectionId, query = {}) {
  const accounts = await getXeroAccounts(connectionId);

  return {
    data: accounts,
    pagination: {
      page: 1,
      pageSize: accounts.length,
      totalItems: accounts.length,
    },
  };
}

module.exports = {
  getCustomers,
  getInvoices,
  getPayments,
  getAccounts,
};