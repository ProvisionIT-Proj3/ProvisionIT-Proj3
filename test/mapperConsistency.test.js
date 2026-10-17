const test = require("node:test");
const assert = require("node:assert/strict");

const { buildQuickbooksAccounts } = require("../src/mappers/quickbooks/accountMapper");
const { buildXeroAccounts } = require("../src/mappers/xero/accountMapper");
const { ACCOUNT_SCHEMA, validate } = require("../src/canonical/schemas");

// The same set of books, expressed as each vendor's raw API responses. The
// canonical output is meant to be vendor-independent, so whatever differs
// between the two outputs is a place a consumer would have to know which
// platform the data came from.
const BOOKS = [
  // [code, name, class, debit, credit]
  ["090", "Business Account", "ASSET", 1000, 0],
  ["610", "Accounts Receivable", "ASSET", 250.5, 0],
  ["800", "Accounts Payable", "LIABILITY", 0, 300.25],
  ["960", "Owner's Equity", "EQUITY", 0, 450.25],
  ["200", "Sales", "REVENUE", 0, 2000],
  ["469", "Rent", "EXPENSE", 1500, 0],
];
const money = (n) => (n === 0 ? "" : n.toFixed(2));
const idOf = (code) => `id-${code}`;

function quickbooksOutput() {
  const classification = { ASSET: "Asset", LIABILITY: "Liability", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Expense" };
  const accounts = BOOKS.map(([code, name, cls]) => ({
    Id: idOf(code),
    AcctNum: code,
    Name: name,
    Classification: classification[cls],
    AccountType: "Bank",
    TaxCodeRef: { value: "2" },
  }));
  const report = {
    Header: { EndPeriod: "2026-06-30" },
    Rows: {
      Row: [
        ...BOOKS.map(([code, name, , debit, credit]) => ({
          ColData: [{ value: name, id: idOf(code) }, { value: money(debit) }, { value: money(credit) }],
        })),
        { type: "Section", group: "GrandTotal", Summary: { ColData: [{ value: "TOTAL" }, { value: "2750.50" }, { value: "2750.50" }] } },
      ],
    },
  };
  return buildQuickbooksAccounts(accounts, report, [{ Id: "2", Name: "GST" }]);
}

function xeroOutput() {
  const sectionOf = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Expenses" };
  const accounts = BOOKS.map(([code, name, cls]) => ({
    AccountID: idOf(code),
    Code: code,
    Name: name,
    Type: "BANK",
    Class: cls,
    TaxType: "OUTPUT",
  }));
  const cell = (Value, id) => ({ Value, Attributes: id ? [{ Id: "account", Value: id }] : undefined });
  const report = {
    Reports: [
      {
        ReportDate: "30 June 2026",
        Rows: [
          { RowType: "Header", Cells: ["Account", "Debit", "Credit", "YTD Debit", "YTD Credit"].map((Value) => ({ Value })) },
          ...Object.values(sectionOf)
            .filter((v, i, all) => all.indexOf(v) === i)
            .map((Title) => ({
              RowType: "Section",
              Title,
              Rows: BOOKS.filter(([, , cls]) => sectionOf[cls] === Title).map(([code, name, , debit, credit]) => ({
                RowType: "Row",
                Cells: [cell(name, idOf(code)), cell(""), cell(""), cell(money(debit)), cell(money(credit))],
              })),
            })),
        ],
      },
    ],
  };
  return buildXeroAccounts(accounts, report);
}

const OUTPUTS = { quickbooks: quickbooksOutput(), xero: xeroOutput() };
const detailRows = (output) => output.filter((r) => !r.isHeader);
const headerRows = (output) => output.filter((r) => r.isHeader);
const shape = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "_vendorSpecific").map(([k, v]) => [k, typeof v]));

test("every row from both vendors passes the canonical schema", () => {
  for (const [vendor, output] of Object.entries(OUTPUTS)) {
    assert.ok(output.length > 0, vendor);
    for (const row of output) {
      const { valid, errors } = validate("account", row);
      assert.ok(valid, `${vendor} ${row.id}: ${errors.join("; ")}`);
    }
  }
});

test("both vendors produce rows with exactly the same fields", () => {
  const canonicalFields = Object.keys(ACCOUNT_SCHEMA);

  for (const kind of [detailRows, headerRows]) {
    const [qbo, xro] = [kind(OUTPUTS.quickbooks), kind(OUTPUTS.xero)].map((rows) => Object.keys(rows[0]).sort());
    assert.deepEqual(qbo, xro, `${kind.name} rows differ between vendors`);
  }

  // And nothing outside the canonical schema (bar the mapper-internal _vendorSpecific) leaks out.
  for (const output of Object.values(OUTPUTS)) {
    for (const row of output) {
      const extra = Object.keys(row).filter((k) => !canonicalFields.includes(k) && k !== "_vendorSpecific");
      assert.deepEqual(extra, [], `${row.id} has fields outside the canonical schema`);
    }
  }
});

test("every field has the same JavaScript type in both vendors", () => {
  const typesOf = (output) => Object.assign({}, ...detailRows(output).map(shape));
  const { quickbooks, xero } = OUTPUTS;

  for (const [field, type] of Object.entries(typesOf(quickbooks))) {
    const other = typesOf(xero)[field];
    assert.equal(other, type, `field ${field}`);
  }
});

test("the same books give the same balances, sides, names, codes and tax codes in both vendors", () => {
  const pickFields = ({ name, code, drCr, value, isHeader, level, taxCode }) => ({ name, code, drCr, value, isHeader, level, taxCode });
  const byName = (output) => new Map(detailRows(output).map((r) => [r.name, pickFields(r)]));
  const [qbo, xro] = [byName(OUTPUTS.quickbooks), byName(OUTPUTS.xero)];

  assert.equal(qbo.size, BOOKS.length);
  assert.deepEqual([...qbo.keys()].sort(), [...xro.keys()].sort());
  for (const [name, row] of qbo) assert.deepEqual(xro.get(name), row, name);
});

test("both vendors' detail rows reproduce the same trial balance totals", () => {
  for (const [vendor, output] of Object.entries(OUTPUTS)) {
    const side = (s) => Math.round(detailRows(output).filter((r) => r.drCr === s).reduce((sum, r) => sum + r.value, 0) * 100) / 100;
    assert.equal(side("Dr"), 2750.5, `${vendor} debits`);
    assert.equal(side("Cr"), 2750.5, `${vendor} credits`);
  }
});

// Known gaps: the shape is consistent, but some VALUES still depend on the
// vendor. The first test pins today's behaviour so a change is noticed; the
// todos stay visible in the test output without blocking CI.
test("known difference: header grouping depends on the vendor", () => {
  // Xero groups by account class; QuickBooks' flat report gives one "Accounts" header.
  const names = (output) => headerRows(output).map((h) => h.name);
  assert.deepEqual(names(OUTPUTS.quickbooks), ["Accounts"]);
  assert.deepEqual(names(OUTPUTS.xero), ["Assets", "Liabilities", "Equity", "Revenue", "Expenses"]);
});

test.todo("account `type` uses one vocabulary across vendors (Xero 'CURRLIAB' vs QuickBooks 'Accounts Payable')");
test.todo("QuickBooks headers group accounts by Classification, as Xero's sections do");
