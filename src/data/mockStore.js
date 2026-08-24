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

module.exports = { customers, invoices, payments };
