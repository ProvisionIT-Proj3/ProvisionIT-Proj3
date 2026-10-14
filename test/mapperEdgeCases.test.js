const test = require("node:test");
const assert = require("node:assert/strict");
const { inject } = require("./helpers/inject");

// Edge cases the fixture tests don't reach. The database driver, the auth
// registry and the connector factory are faked so persistence.js and
// dataService.js can be loaded and driven without a database.
const queries = [];
inject("pg", {
  Pool: class {
    async connect() {
      return {
        query: async (sql, params = []) => {
          queries.push({ sql, params });
          return { rows: [] };
        },
        release() {},
      };
    }
  },
  types: { setTypeParser() {} },
});

let connectorAccounts = [];
inject("../src/auth/index.js", { registry: { resolveProvider: async () => "xero" } });
inject("../src/connector/connectorFactory.js", {
  createConnector: () => ({ getAccounts: async () => connectorAccounts }),
});

const persistence = require("../src/persistence");
const dataService = require("../src/services/dataService");
const { parseTrialBalanceReport, buildQuickbooksAccounts } = require("../src/mappers/quickbooks/accountMapper");
const { mapXeroTaxCode, XERO_TAX_TYPE_TO_CLIENT_CODE } = require("../src/mappers/xero/accountMapper");
const { taxTypes: XERO_SPEC_TAX_TYPES } = require("./fixtures/xero/tax_types.json");

const CONN = "11111111-1111-1111-1111-111111111111";

// --- QuickBooks: nested sections -------------------------------------------

const dataRow = (name, id, debit, credit) => ({
  type: "Data",
  ColData: [{ value: name, id }, { value: debit }, { value: credit }],
});

test("QuickBooks: sub-accounts nested under a parent section are kept, not dropped", () => {
  const report = {
    Rows: {
      Row: [
        {
          type: "Section",
          Header: { ColData: [{ value: "Assets" }, { value: "" }, { value: "" }] },
          Rows: {
            Row: [
              dataRow("Checking", "35", "100.00", ""),
              {
                type: "Section",
                Header: { ColData: [{ value: "Receivables" }, { value: "" }, { value: "" }] },
                Rows: { Row: [dataRow("Trade Debtors", "36", "40.00", ""), dataRow("Other Debtors", "37", "10.00", "")] },
                Summary: { ColData: [{ value: "Total Receivables" }, { value: "50.00" }, { value: "" }] },
              },
            ],
          },
          Summary: { ColData: [{ value: "Total Assets" }, { value: "150.00" }, { value: "" }] },
        },
      ],
    },
  };

  const [section, ...extra] = parseTrialBalanceReport(report);
  assert.equal(extra.length, 0);
  assert.deepEqual(section.rows.map((r) => r.accountId), ["35", "36", "37"]);
  // The outer section's own Summary is kept; the nested "Total Receivables" subtotal is ignored.
  // (That the header uses a Summary over a re-sum is tested in accountRows.test.js.)
  assert.deepEqual(section.summary, { debit: 150, credit: 0 });

  const accounts = buildQuickbooksAccounts([], report);
  assert.equal(accounts.filter((a) => !a.isHeader).length, 3);
  assert.equal(accounts[0].value, 150);
});

// --- Empty reports must not wipe stored data ---------------------------------

test("an empty report is rejected and the stored accounts are left alone", async () => {
  queries.length = 0;
  connectorAccounts = [];

  await assert.rejects(
    () => dataService.syncAccounts(CONN),
    (err) => err.code === "EMPTY_REPORT" && err.status === 502 && /left unchanged/.test(err.message)
  );
  assert.equal(queries.length, 0, "nothing was sent to the database, so nothing was deleted");
});

// --- Large charts of accounts ----------------------------------------------

const POSTGRES_MAX_PARAMETERS = 65535;
const fakeAccounts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: `acc-${i}`,
    sourceSystem: "xero",
    name: `Account ${i}`,
    isHeader: false,
    level: 2,
    value: i,
  }));

test("saveAccounts keeps every statement under Postgres's parameter limit and numbers rows continuously", async () => {
  for (const count of [1, 1000, 1001, 6000]) {
    queries.length = 0;
    const result = await persistence.saveAccounts(CONN, fakeAccounts(count), "2026-06-30");
    assert.equal(result.saved, count);

    const inserts = queries.filter((q) => /^\s*INSERT INTO accounts/.test(q.sql));
    assert.equal(inserts.length, Math.ceil(count / 1000), `${count} rows`);
    for (const q of inserts) assert.ok(q.params.length <= POSTGRES_MAX_PARAMETERS, `${count} rows`);

    // Parameter 11 of each 12 is sort_order; across chunks it must run 1..count.
    const sortOrders = inserts.flatMap((q) => q.params.filter((_, i) => i % 12 === 10));
    assert.deepEqual(sortOrders, Array.from({ length: count }, (_, i) => i + 1), `${count} rows`);
  }
});

test("saveAccounts replaces the snapshot inside one transaction", async () => {
  queries.length = 0;
  await persistence.saveAccounts(CONN, fakeAccounts(2500), "2026-06-30");

  const verbs = queries.map((q) => q.sql.trim().split(/\s+/)[0]);
  assert.deepEqual(verbs, ["BEGIN", "DELETE", "INSERT", "INSERT", "INSERT", "UPDATE", "COMMIT"]);
});

// --- Xero tax types --------------------------------------------------------

test("every Xero tax type in the mapping table is a real tax type from Xero's spec", () => {
  const unknown = Object.keys(XERO_TAX_TYPE_TO_CLIENT_CODE).filter((t) => !XERO_SPEC_TAX_TYPES.includes(t));
  assert.deepEqual(unknown, [], "typo or retired tax type in XERO_TAX_TYPE_TO_CLIENT_CODE");
});

test("mapped Xero tax types translate to the client's codes", () => {
  assert.equal(mapXeroTaxCode("OUTPUT"), "GST");
  assert.equal(mapXeroTaxCode("INPUT"), "GST");
  assert.equal(mapXeroTaxCode("EXEMPTOUTPUT"), "FRE");
  assert.equal(mapXeroTaxCode("CAPEXINPUT"), "GCA");
  assert.equal(mapXeroTaxCode("NONE"), "N-T");
  assert.equal(mapXeroTaxCode("BASEXCLUDED"), "N-T");
  assert.equal(mapXeroTaxCode(undefined), undefined);
  assert.equal(mapXeroTaxCode(""), undefined);
});

// These tax types exist in Xero's spec and look like the same family as the
// mapped ones (GST free / input taxed / imports), but have no client code yet.
// They come out as UNMAPPED:<type>. When the client says which code each one
// maps to, add it to the table and move it out of this list.
const AWAITING_CLIENT_CODE = ["INPUTTAXED", "GSTONIMPORTS"];

test("Xero tax types awaiting a client code are visible as UNMAPPED, not silently mapped", () => {
  for (const type of AWAITING_CLIENT_CODE) {
    assert.ok(XERO_SPEC_TAX_TYPES.includes(type), `${type} is in Xero's spec`);
    assert.equal(mapXeroTaxCode(type), `UNMAPPED:${type}`);
  }
});
