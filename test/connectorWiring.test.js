const test = require("node:test");
const assert = require("node:assert/strict");
const { inject } = require("./helpers/inject");

// End to end from the vendor HTTP responses to what is saved: only the HTTP
// clients and the database are faked, so connector -> mapper -> dataService
// wiring is exercised for real, on the fixtures in test/fixtures.
const QBO_CONN = "22222222-2222-2222-2222-222222222222";
const XERO_CONN = "33333333-3333-3333-3333-333333333333";

inject("../src/auth/index.js", {
  registry: {
    resolveProvider: async (id) => ({ [QBO_CONN]: "quickbooks", [XERO_CONN]: "xero" })[id] ?? null,
  },
});

const saved = [];
inject("../src/persistence.js", {
  saveAccounts: async (connectionId, accounts, reportDate) => {
    saved.push({ connectionId, accounts, reportDate });
    return { saved: accounts.length };
  },
});

const qboRequests = [];
inject("../src/connector/quickbooks/quickBooksClient.js", {
  quickBooksRequest: async (connectionId, path) => {
    const decoded = decodeURIComponent(path);
    qboRequests.push(decoded);
    if (decoded.startsWith("reports/TrialBalance")) return require("./fixtures/quickbooks/au_company/trial_balance.json");
    if (/from Account/i.test(decoded)) return require("./fixtures/quickbooks/au_company/account_query.json");
    if (/from TaxCode/i.test(decoded)) return require("./fixtures/quickbooks/au_company/taxcode_query.json");
    throw new Error(`Unexpected QuickBooks request: ${decoded}`);
  },
});

const xeroRequests = [];
inject("../src/connector/xero/xeroClient.js", {
  xeroRequest: async (connectionId, path) => {
    xeroRequests.push(path);
    if (path === "Accounts") return require("./fixtures/xero/accounts.json");
    if (path.startsWith("Reports/TrialBalance")) return require("./fixtures/xero/trial_balance.official.json");
    throw new Error(`Unexpected Xero request: ${path}`);
  },
});

const dataService = require("../src/services/dataService");
const quickBooksConnector = require("../src/connector/quickbooks");
const xeroConnector = require("../src/connector/xero");

test("QuickBooks sync: fetches accounts, trial balance and tax codes, and stores the mapped snapshot", async () => {
  saved.length = 0;
  qboRequests.length = 0;

  const result = await dataService.syncAccounts(QBO_CONN);

  assert.equal(result.data.saved, 14); // 1 header + 13 detail rows
  assert.equal(result.data.reportDate, "2026-06-30"); // from the report, not the server clock
  assert.equal(saved.length, 1);
  assert.equal(saved[0].connectionId, QBO_CONN);
  assert.equal(saved[0].reportDate, "2026-06-30");

  const sales = saved[0].accounts.find((a) => a.id === "60");
  assert.equal(sales.sourceSystem, "quickbooks");
  assert.equal(sales.taxCode, "GST");
  assert.equal(sales.value, 42000);

  assert.ok(qboRequests.some((p) => p.startsWith("reports/TrialBalance")));
  assert.ok(qboRequests.some((p) => /from Account/i.test(p)));
  assert.ok(qboRequests.some((p) => /from TaxCode/i.test(p)));
});

test("Xero live trial balance: canonical rows with balances and the report's own date", async () => {
  const result = await dataService.getTrialBalance(XERO_CONN);

  assert.equal(result.data.length, 24); // 5 section headers + 19 accounts, no grand-total header
  assert.equal(result.meta.reportDate, "2019-04-24");
  assert.ok(result.data.every((a) => a._vendorSpecific === undefined));

  const bank = result.data.find((a) => a.code === "088");
  assert.equal(bank.value, 7639.04);
  assert.equal(bank.drCr, "Dr");
});

test("QuickBooks connector passes report period and basis through to the TrialBalance request", async () => {
  qboRequests.length = 0;

  await quickBooksConnector.getAccountsReport(QBO_CONN, {
    startDate: "2025-07-01",
    endDate: "2026-06-30",
    accountingMethod: "Cash",
  });

  assert.ok(
    qboRequests.includes("reports/TrialBalance?start_date=2025-07-01&end_date=2026-06-30&accounting_method=Cash"),
    qboRequests.join("\n")
  );
});

test("Xero connector passes the as-at date through to the TrialBalance request", async () => {
  xeroRequests.length = 0;

  await xeroConnector.getAccountsReport(XERO_CONN, { endDate: "2026-06-30" });

  assert.ok(xeroRequests.includes("Reports/TrialBalance?date=2026-06-30"), xeroRequests.join("\n"));
});
