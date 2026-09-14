// demo-server.js — standalone mock API for demo screenshots only.
// Does NOT touch the real code or database. Run: node demo-server.js
const express = require("express");
const app = express();

const data = {
  customers: [
    { id: "cust_001", sourceSystem: "xero", displayName: "Acme Pty Ltd", email: "accounts@acme.com.au", phone: "+61 3 9000 1234", status: "active", currency: "AUD" },
    { id: "cust_002", sourceSystem: "xero", displayName: "Beta Traders", email: "finance@beta.com.au", phone: "+61 2 8000 5678", status: "active", currency: "AUD" },
  ],
  invoices: [
    { id: "inv_1001", sourceSystem: "xero", invoiceNumber: "INV-1001", customerId: "cust_001", transactionDate: "2026-05-01", dueDate: "2026-05-15", total: 1100.0, amountDue: 0.0, tax: 100.0, currency: "AUD" },
    { id: "inv_1002", sourceSystem: "xero", invoiceNumber: "INV-1002", customerId: "cust_002", transactionDate: "2026-05-18", dueDate: "2026-06-01", total: 550.0, amountDue: 550.0, tax: 50.0, currency: "AUD" },
  ],
  payments: [
    { id: "pay_5001", sourceSystem: "xero", direction: "receivable", partyId: "cust_001", date: "2026-05-14", amount: 1100.0, invoiceAllocations: [{ invoiceId: "inv_1001", amount: 1100.0 }], paymentType: "bank_transfer" },
  ],
  accounts: [
    { id: "header:Bank", sourceSystem: "xero", code: "HDR-1", name: "Bank", type: "Bank", drCr: "Dr", isHeader: true, level: 1, value: 25000.0, taxCode: null },
    { id: "acc_090", sourceSystem: "xero", code: "090", name: "Business Bank Account", type: "Bank", drCr: "Dr", isHeader: false, level: 2, value: 25000.0, taxCode: "N-T" },
    { id: "header:Revenue", sourceSystem: "xero", code: "HDR-2", name: "Revenue", type: "Revenue", drCr: "Cr", isHeader: true, level: 1, value: 40000.0, taxCode: null },
    { id: "acc_200", sourceSystem: "xero", code: "200", name: "Sales", type: "Revenue", drCr: "Cr", isHeader: false, level: 2, value: 40000.0, taxCode: "GST" },
  ],
};

function respond(res, items) {
  res.json({ data: items, pagination: { page: 1, pageSize: 25, totalItems: items.length, totalPages: 1 } });
}

app.get("/api/v1/customers", (req, res) => respond(res, data.customers));
app.get("/api/v1/invoices", (req, res) => respond(res, data.invoices));
app.get("/api/v1/payments", (req, res) => respond(res, data.payments));
app.get("/api/v1/accounts", (req, res) => respond(res, data.accounts));

app.listen(3001, () => console.log("Demo API running on http://localhost:3001"));
