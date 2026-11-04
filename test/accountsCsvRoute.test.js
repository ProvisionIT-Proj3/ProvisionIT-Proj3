const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { inject } = require("./helpers/inject");

const CONN = "5adce2dd-1331-4700-8600-c226221d89da";
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

const stored = (n, over) => ({
  account_id: `i${n}`, connection_id: CONN, source_id: `s${n}`, sort_order: n, report_date: "2026-06-30",
  created_at: "x", updated_at: "2026-09-01T00:00:00.000Z", tax_code: null, ...over,
});
const ROWS = [
  stored(1, { code: "1-0000", name: "Assets", type: "Asset", dr_cr: "Dr", is_header: true, level: 1, value: "100.00" }),
  stored(2, { code: "1-1110", name: "Cheque Account", type: "BANK", dr_cr: "Dr", is_header: false, level: 3, value: "100.00", tax_code: "N-T" }),
];

inject("../src/persistence.js", {
  async getConnectionById(id) {
    return id === CONN ? { connection_id: CONN, company_name: "Riverbend Cafe", platform: "xero" } : null;
  },
  async getAccountsByConnection() { return ROWS; },
});
inject("../src/auth/index.js", {
  registry: { resolveProvider: async (id) => (id === CONN ? "xero" : null) },
  router: express.Router(),
});
inject("../src/connector/connectorFactory.js", { createConnector: () => ({}) });

const app = require("../src/app");

async function get(path) {
  const server = http.createServer(app).listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: res.status, headers: res.headers, text: await res.text() };
  } finally {
    server.close();
  }
}

test("GET /accounts?format=csv returns the stored accounts as a CSV download", async () => {
  const { status, headers, text } = await get(`/api/v1/accounts?connectionId=${CONN}&format=csv`);

  assert.equal(status, 200);
  assert.match(headers.get("content-type"), /^text\/csv/);
  assert.equal(headers.get("content-disposition"), 'attachment; filename="accounts-2026-06-30.csv"');
  assert.equal(
    text,
    [
      "Account #,Account,Type,Dr/Cr,Header/Detail,Level,Balance,Tax Code",
      "1-0000,Assets,Asset,Debit,Header,1,100.00,",
      "1-1110,Cheque Account,BANK,Debit,Detail,3,100.00,N-T",
      "",
    ].join("\r\n")
  );
});

test("?preamble=true adds the company name and as-of date", async () => {
  const { text } = await get(`/api/v1/accounts?connectionId=${CONN}&format=csv&preamble=true`);
  assert.deepEqual(text.split("\r\n").slice(0, 3), ["Riverbend Cafe", "Accounts List [Detail]", "As of 30/06/2026"]);
});

test("the CSV ignores paging, and the default response is still JSON", async () => {
  const csv = await get(`/api/v1/accounts?connectionId=${CONN}&format=csv&pageSize=1`);
  assert.equal(csv.text.trimEnd().split("\r\n").length, 3); // column row + both accounts

  const json = await get(`/api/v1/accounts?connectionId=${CONN}`);
  assert.match(json.headers.get("content-type"), /json/);
});

test("an unknown connection is a 404, not an empty file", async () => {
  const { status } = await get(`/api/v1/accounts?connectionId=${UNKNOWN}&format=csv`);
  assert.equal(status, 404);
});
