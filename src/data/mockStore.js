// Temporary stand-in for the database.
// Once Chris confirms canonical fields and Giorgio's DB is ready,
// this file gets swapped for a real DB connection (e.g. via a db client).
// Everything else (routes, services) should NOT need to change when that happens.

const customers = [
  { id: "cust_001", name: "Acme Pty Ltd", email: "accounts@acme.com.au" },
  { id: "cust_002", name: "Beta Traders", email: "finance@beta.com.au" },
];

const invoices = [
  { id: "inv_1001", customerId: "cust_001", status: "paid", dueDate: "2026-05-15", total: 1100.00 },
  { id: "inv_1002", customerId: "cust_002", status: "unpaid", dueDate: "2026-06-01", total: 550.00 },
];

const payments = [
  { id: "pay_5001", invoiceId: "inv_1001", date: "2026-05-14", amount: 1100.00 },
];

// Canonical Account rows (header + detail), matching Chris's ACCOUNT_SCHEMA.
const accounts = [
  { id: "header:Bank", sourceSystem: "xero", code: "HDR-1", name: "Bank", type: "Bank", drCr: "Dr", isHeader: true, level: 1, value: 25000.0, taxCode: null },
  { id: "acc_090", sourceSystem: "xero", code: "090", name: "Business Bank Account", type: "Bank", drCr: "Dr", isHeader: false, level: 2, value: 25000.0, taxCode: "N-T" },
  { id: "header:Revenue", sourceSystem: "xero", code: "HDR-2", name: "Revenue", type: "Revenue", drCr: "Cr", isHeader: true, level: 1, value: 40000.0, taxCode: null },
  { id: "acc_200", sourceSystem: "xero", code: "200", name: "Sales", type: "Revenue", drCr: "Cr", isHeader: false, level: 2, value: 40000.0, taxCode: "GST" },
];

module.exports = { customers, invoices, payments, accounts };