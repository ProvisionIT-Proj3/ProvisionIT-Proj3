const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { inject } = require("./helpers/inject");

const CONN = "5adce2dd-1331-4700-8600-c226221d89da";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

// Four stored rows in report order, shaped like the real accounts table.
const ROWS = [
  { account_id: "internal-1", connection_id: CONN, source_id: "header:Bank", code: "HDR-1", name: "Bank", type: "Bank", dr_cr: "Dr", is_header: true, level: 1, value: "25000.00", tax_code: null, sort_order: 1, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
  { account_id: "internal-2", connection_id: CONN, source_id: "acc_090", code: "090", name: "Business Bank Account", type: "BANK", dr_cr: "Dr", is_header: false, level: 2, value: "25000.00", tax_code: "N-T", sort_order: 2, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
  { account_id: "internal-3", connection_id: CONN, source_id: "header:Revenue", code: "HDR-2", name: "Revenue", type: "Revenue", dr_cr: "Cr", is_header: true, level: 1, value: "40000.00", tax_code: null, sort_order: 3, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
  { account_id: "internal-4", connection_id: CONN, source_id: "acc_200", code: "200", name: "Sales", type: "REVENUE", dr_cr: "Cr", is_header: false, level: 2, value: "40000.00", tax_code: "GST", sort_order: 4, report_date: "2026-08-31", created_at: "x", updated_at: "2026-09-01T00:00:00.000Z" },
];

const saves = [];
let storedRows = ROWS;
inject("../src/persistence.js", {
  async getConnectionById(id) {
    return id === CONN ? { connection_id: CONN, platform: "xero", last_synced_at: "2026-09-01T00:00:00.000Z" } : null;
  },
  async getAccountsByConnection() { return storedRows; },
  async saveAccounts(connectionId, accounts, reportDate) {
    saves.push({ connectionId, accounts, reportDate });
    return { saved: accounts.length };
  },
});
// src/app.js mounts the OAuth router too, so the fake auth module needs one.
const express = require("express");
inject("../src/auth/index.js", {
  registry: { resolveProvider: async (id) => (id === CONN ? "xero" : null) },
  router: express.Router(),
});
const fetched = [{ id: "acc_1", sourceSystem: "xero", name: "Cash", isHeader: false, level: 2 }];
inject("../src/connector/connectorFactory.js", {
  createConnector: () => ({
    getAccounts: async () => fetched,
    getTrialBalance: async () => ({ rows: [] }),
  }),
});

const svc = require("../src/services/dataService");
const { requireConnectionId, parsePagination } = require("../src/services/validation");
const app = require("../src/app");

test.beforeEach(() => test.mock.method(console, "warn", () => {}));

// ---------- validation ----------

test("missing connectionId is a 400 MISSING_CONNECTION_ID", () => {
  assert.throws(() => requireConnectionId(undefined), { status: 400, code: "MISSING_CONNECTION_ID" });
});

test("malformed connectionId is a 400, not a database error", () => {
  assert.throws(() => requireConnectionId("test"), { status: 400, code: "INVALID_PARAMETER", message: /valid UUID/ });
});

test("pagination defaults, caps and rejects bad input", () => {
  assert.deepEqual(parsePagination({}), { page: 1, pageSize: 100 });
  assert.deepEqual(parsePagination({ page: "2", pageSize: "10" }), { page: 2, pageSize: 10 });
  assert.equal(parsePagination({ pageSize: "99999" }).pageSize, 500);
  for (const bad of [{ page: "abc" }, { page: "0" }, { pageSize: "-1" }, { page: "1.5" }]) {
    assert.throws(() => parsePagination(bad), { status: 400 });
  }
});

// ---------- GET accounts (stored) ----------

test("getAccounts returns stored rows in report order with canonical field names", async () => {
  const res = await svc.getAccounts(CONN);
  assert.deepEqual(res.data.map((a) => a.name), ["Bank", "Business Bank Account", "Revenue", "Sales"]);

  const sales = res.data[3];
  assert.equal(sales.id, "acc_200"); // source_id becomes id
  assert.equal(sales.drCr, "Cr");
  assert.equal(sales.isHeader, false);
  assert.equal(sales.taxCode, "GST");
  assert.equal(sales.value, 40000);
  assert.equal(sales.sourceSystem, "xero"); // stamped from connections.platform
  assert.equal(res.data[0].isHeader, true);
});

test("getAccounts never leaks internal database fields", async () => {
  const [row] = (await svc.getAccounts(CONN)).data;
  for (const key of ["accountId", "connectionId", "sortOrder", "createdAt", "source_id", "dr_cr"]) {
    assert.equal(row[key], undefined, `${key} leaked`);
  }
});

test("getAccounts paginates and reports totals", async () => {
  const res = await svc.getAccounts(CONN, { page: "2", pageSize: "3" });
  assert.deepEqual(res.data.map((a) => a.name), ["Sales"]);
  assert.deepEqual(res.pagination, { page: 2, pageSize: 3, totalItems: 4, totalPages: 2 });
});

test("getAccounts exposes sync metadata", async () => {
  const { meta } = await svc.getAccounts(CONN);
  assert.equal(meta.lastSyncedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(meta.reportDate, "2026-08-31");
});

test("getAccounts before the first sync returns an empty list, not an error", async () => {
  storedRows = [];
  const res = await svc.getAccounts(CONN);
  storedRows = ROWS;
  assert.deepEqual(res.data, []);
  assert.equal(res.pagination.totalItems, 0);
  assert.equal(res.meta.reportDate, null);
});

test("getAccounts on an unknown connection is a 404", async () => {
  await assert.rejects(svc.getAccounts(UNKNOWN), { status: 404, code: "CONNECTION_NOT_FOUND" });
});

// ---------- POST sync ----------

test("syncAccounts fetches from the connector and stores the snapshot", async () => {
  saves.length = 0;
  const res = await svc.syncAccounts(CONN);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].connectionId, CONN);
  assert.deepEqual(saves[0].accounts, fetched);
  assert.match(saves[0].reportDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(res.data.saved, 1);
});

test("syncAccounts on an unknown connection is a 404 and saves nothing", async () => {
  saves.length = 0;
  await assert.rejects(svc.syncAccounts(UNKNOWN), { status: 404 });
  assert.equal(saves.length, 0);
});

// ---------- HTTP layer ----------

async function call(method, path) {
  const server = http.createServer(app).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("GET /api/v1/accounts without connectionId returns the standard error shape", async () => {
  const res = await call("GET", "/api/v1/accounts");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "MISSING_CONNECTION_ID");
});

test("GET /api/v1/accounts with a bad uuid returns 400 INVALID_PARAMETER", async () => {
  const res = await call("GET", "/api/v1/accounts?connectionId=nope");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "INVALID_PARAMETER");
});

test("GET /api/v1/accounts returns data, pagination and meta", async () => {
  const res = await call("GET", `/api/v1/accounts?connectionId=${CONN}&pageSize=2`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.pagination.totalPages, 2);
  assert.ok(res.body.meta);
});

test("POST /api/v1/sync stores accounts and reports how many", async () => {
  const res = await call("POST", `/api/v1/sync?connectionId=${CONN}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.saved, 1);
});

test("unknown connection over HTTP is a 404 with the standard error shape", async () => {
  const res = await call("GET", `/api/v1/accounts?connectionId=${UNKNOWN}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "CONNECTION_NOT_FOUND");
});
