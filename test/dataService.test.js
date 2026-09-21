// Tests for the middleware service layer (src/services/dataService.js).
//
// These run WITHOUT a database. The real src/persistence.js is swapped for an
// in-memory fake before dataService is loaded, so the tests exercise routing
// of data through validation, pagination and canonical mapping only.
//
// Row shapes below use the real Supabase column names from persistence.js.
//
// Run with: npm test

const test = require("node:test");
const assert = require("node:assert/strict");

const CONN = "5adce2dd-1331-4700-8600-c226221d89da";
const UNKNOWN_CONN = "00000000-0000-0000-0000-000000000000";

// ---------- fake persistence ----------

const customerRows = Array.from({ length: 30 }, (_, i) => ({
  customer_id: `internal-cust-${i + 1}`,
  connection_id: CONN,
  source_id: `CUST-${i + 1}`,
  name: `Customer ${i + 1}`,
  email: `c${i + 1}@example.com`,
  phone: null,
  status: "active",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-07T18:18:04.897Z",
}));

const fakePersistence = {
  async getConnectionById(id) {
    return id === CONN ? { connection_id: CONN, company_name: "Riverbend Cafe", platform: "xero" } : null;
  },
  async getCustomersByConnection() {
    return customerRows;
  },
  async getInvoicesByConnection(connectionId, filters) {
    fakePersistence.lastInvoiceFilters = filters;
    return {
      data: [
        {
          invoice_id: "internal-inv-1",
          customer_id: "internal-cust-2",
          source_id: "INV-1043",
          amount: "1220.00",
          status: "paid",
          type: "sales_invoice",
          issue_date: "2026-08-15",
          due_date: "2026-08-25",
          created_at: "2026-09-01T00:00:00.000Z",
          customer_name: "Customer 2",
          customer_source_id: "CUST-2",
        },
      ],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 57 },
    };
  },
  async getPaymentsByConnection() {
    return [
      {
        payment_id: "internal-pay-1",
        invoice_id: "internal-inv-1",
        source_id: "PAY-001",
        amount: "1220.00",
        payment_date: "2026-08-24",
        method: "bank_transfer",
        status: "completed",
        created_at: "2026-09-01T00:00:00.000Z",
        customer_id: "internal-cust-2",
        type: "sales_invoice",
        customer_source_id: "CUST-2",
      },
      {
        payment_id: "internal-pay-2",
        invoice_id: "internal-inv-9",
        source_id: "PAY-002",
        amount: "300.50",
        payment_date: "2026-08-25",
        method: "card",
        status: "completed",
        created_at: "2026-09-01T00:00:00.000Z",
        customer_id: "internal-cust-3",
        type: "bill",
        customer_source_id: "SUPP-7",
      },
    ];
  },
  async getAccountsByConnection() {
    // Already in sort_order, as the real query returns them.
    return [
      { account_id: "internal-acc-1", connection_id: CONN, source_id: "header:Bank", code: "HDR-1", name: "Bank", type: "Bank", dr_cr: "Dr", is_header: true, level: 1, value: "25000.00", tax_code: null, sort_order: 1, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
      { account_id: "internal-acc-2", connection_id: CONN, source_id: "acc_090", code: "090", name: "Business Bank Account", type: "BANK", dr_cr: "Dr", is_header: false, level: 2, value: "25000.00", tax_code: "N-T", sort_order: 2, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
      { account_id: "internal-acc-3", connection_id: CONN, source_id: "header:Revenue", code: "HDR-2", name: "Revenue", type: "Revenue", dr_cr: "Cr", is_header: true, level: 1, value: "40000.00", tax_code: null, sort_order: 3, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
      { account_id: "internal-acc-4", connection_id: CONN, source_id: "acc_200", code: "200", name: "Sales", type: "REVENUE", dr_cr: "Cr", is_header: false, level: 2, value: "40000.00", tax_code: "GST", sort_order: 4, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
    ];
  },
};

// Inject the fake into the module cache so dataService never loads the real
// persistence layer (and never tries to open a Postgres connection).
const persistencePath = require.resolve("../src/persistence");
require.cache[persistencePath] = {
  id: persistencePath,
  filename: persistencePath,
  loaded: true,
  exports: fakePersistence,
};

const svc = require("../src/services/dataService");

// Silence expected validation warnings from the mapper during tests.
test.beforeEach(() => test.mock.method(console, "warn", () => {}));

async function rejectsWithStatus(promise, status, messagePattern) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status);
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
}

// ---------- request validation ----------

test("missing connectionId returns 400", async () => {
  await rejectsWithStatus(svc.getCustomers({}), 400, /connectionId is required/);
});

test("malformed connectionId returns 400 before touching the database", async () => {
  await rejectsWithStatus(svc.getCustomers({ connectionId: "test" }), 400, /valid UUID/);
});

test("unknown connectionId returns 404", async () => {
  await rejectsWithStatus(svc.getCustomers({ connectionId: UNKNOWN_CONN }), 404, /Unknown connectionId/);
});

test("non-numeric page returns 400", async () => {
  await rejectsWithStatus(svc.getCustomers({ connectionId: CONN, page: "abc" }), 400, /positive numbers/);
});

test("page below 1 returns 400", async () => {
  await rejectsWithStatus(svc.getCustomers({ connectionId: CONN, page: "0" }), 400);
});

// ---------- customers ----------

test("customers are mapped to canonical field names", async () => {
  const { data } = await svc.getCustomers({ connectionId: CONN });
  const first = data[0];

  assert.equal(first.id, "CUST-1", "id should be the vendor-native source_id");
  assert.equal(first.displayName, "Customer 1", "name should become displayName");
  assert.equal(first.sourceSystem, "xero", "sourceSystem should come from connections.platform");
  assert.equal(first.updatedAt, "2026-09-07T18:18:04.897Z");
});

test("customers do not leak internal database columns", async () => {
  const { data } = await svc.getCustomers({ connectionId: CONN });
  const first = data[0];

  for (const internal of ["customerId", "connectionId", "createdAt", "sourceId", "name"]) {
    assert.ok(!(internal in first), `${internal} should not appear in the response`);
  }
});

test("customers are paginated in the service layer", async () => {
  const page1 = await svc.getCustomers({ connectionId: CONN, pageSize: "10" });
  const page3 = await svc.getCustomers({ connectionId: CONN, page: "3", pageSize: "10" });

  assert.equal(page1.data.length, 10);
  assert.equal(page1.data[0].id, "CUST-1");
  assert.equal(page3.data.length, 10);
  assert.equal(page3.data[0].id, "CUST-21");
  assert.deepEqual(page1.pagination, { page: 1, pageSize: 10, totalItems: 30, totalPages: 3 });
});

test("pageSize is capped at 100", async () => {
  const { pagination } = await svc.getCustomers({ connectionId: CONN, pageSize: "500" });
  assert.equal(pagination.pageSize, 100);
});

// ---------- invoices ----------

test("invoices are mapped to canonical field names", async () => {
  const { data } = await svc.getInvoices({ connectionId: CONN });
  const inv = data[0];

  assert.equal(inv.id, "INV-1043");
  assert.equal(inv.total, 1220, "amount should become a numeric total");
  assert.equal(inv.transactionDate, "2026-08-15", "issue_date should become transactionDate");
  assert.equal(inv.dueDate, "2026-08-25");
  assert.equal(inv.customerId, "CUST-2", "customerId must be the vendor id, not the internal PK");
  assert.equal(inv.sourceSystem, "xero");
});

test("invoice dates are not shifted by timezone", async () => {
  const { data } = await svc.getInvoices({ connectionId: CONN });
  assert.equal(data[0].transactionDate, "2026-08-15");
});

test("invoices pass filters through and trust the database count", async () => {
  const { pagination } = await svc.getInvoices({
    connectionId: CONN,
    status: "paid",
    page: "2",
    pageSize: "10",
  });

  assert.equal(fakePersistence.lastInvoiceFilters.status, "paid");
  assert.equal(fakePersistence.lastInvoiceFilters.page, 2);
  assert.deepEqual(pagination, { page: 2, pageSize: 10, totalItems: 57, totalPages: 6 });
});

// ---------- payments ----------

test("payments are mapped to canonical field names", async () => {
  const { data } = await svc.getPayments({ connectionId: CONN });
  const pay = data[0];

  assert.equal(pay.id, "PAY-001");
  assert.equal(pay.date, "2026-08-24", "payment_date should become date");
  assert.equal(pay.amount, 1220);
  assert.equal(pay.paymentType, "bank_transfer", "method should become paymentType");
  assert.equal(pay.partyId, "CUST-2", "partyId must be the vendor id, not the internal PK");
  assert.equal(pay.sourceSystem, "xero");
});

test("payment direction is receivable for a sales invoice", async () => {
  const { data } = await svc.getPayments({ connectionId: CONN });
  assert.equal(data[0].direction, "receivable");
});

test("payment direction is payable for a bill", async () => {
  const { data } = await svc.getPayments({ connectionId: CONN });
  assert.equal(data[1].direction, "payable");
});

test("the invoice type used to derive direction is not exposed on payments", async () => {
  const { data } = await svc.getPayments({ connectionId: CONN });
  for (const pay of data) {
    assert.ok(!("type" in pay), "type belongs to the invoice, not the payment");
    assert.ok(!("createdAt" in pay));
    assert.ok(!("invoiceId" in pay));
  }
});

// ---------- accounts ----------

test("accounts are mapped to canonical field names", async () => {
  const { data } = await svc.getAccounts({ connectionId: CONN });
  const detail = data[1];

  assert.equal(detail.id, "acc_090", "id should be the vendor source_id");
  assert.equal(detail.code, "090");
  assert.equal(detail.name, "Business Bank Account");
  assert.equal(detail.drCr, "Dr");
  assert.equal(detail.isHeader, false);
  assert.equal(detail.level, 2);
  assert.equal(detail.value, 25000, "numeric value should come back as a number");
  assert.equal(detail.taxCode, "N-T");
  assert.equal(detail.sourceSystem, "xero");
});

test("accounts keep report order: header, then its detail rows", async () => {
  const { data } = await svc.getAccounts({ connectionId: CONN });
  assert.deepEqual(
    data.map((a) => [a.id, a.isHeader, a.level]),
    [
      ["header:Bank", true, 1],
      ["acc_090", false, 2],
      ["header:Revenue", true, 1],
      ["acc_200", false, 2],
    ]
  );
});

test("accounts do not leak internal database columns", async () => {
  const { data } = await svc.getAccounts({ connectionId: CONN });
  for (const acc of data) {
    for (const internal of ["accountId", "connectionId", "createdAt", "sortOrder", "sourceId"]) {
      assert.ok(!(internal in acc), `${internal} should not appear in the response`);
    }
  }
});

test("accounts validates connectionId", async () => {
  await rejectsWithStatus(svc.getAccounts({ connectionId: "test" }), 400);
});

// ---------- response shape ----------

test("every endpoint returns the same data + pagination shape", async () => {
  const responses = await Promise.all([
    svc.getCustomers({ connectionId: CONN }),
    svc.getInvoices({ connectionId: CONN }),
    svc.getPayments({ connectionId: CONN }),
    svc.getAccounts({ connectionId: CONN }),
  ]);

  for (const res of responses) {
    assert.ok(Array.isArray(res.data));
    assert.deepEqual(Object.keys(res.pagination).sort(), ["page", "pageSize", "totalItems", "totalPages"]);
  }
});