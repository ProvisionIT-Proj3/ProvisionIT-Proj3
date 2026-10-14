const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAmount, netBalance, buildAccountRows } = require("../src/mappers/shared/accountRows");
const quickbooks = require("../src/mappers/quickbooks/accountMapper");
const xero = require("../src/mappers/xero/accountMapper");

// --- parseAmount -------------------------------------------------------------

test("parseAmount reads the amount formats vendors send", () => {
  const cases = [
    ["", 0],
    [undefined, 0],
    [null, 0],
    [12.5, 12.5],
    ["0", 0],
    ["12.34", 12.34],
    [".5", 0.5],
    ["5.", 5],
    ["+7.25", 7.25],
    ["-50.00", -50],
    ["(75.25)", -75.25],
    ["1,234.50", 1234.5],
    ["1,234,567.89", 1234567.89],
    ["-1,234.50", -1234.5],
    ["$1,234.50", 1234.5],
    ["($1,234.50)", -1234.5],
    ["  42.00  ", 42],
    ["12 345.00", 12345], // spaces are stripped, as before
  ];
  for (const [raw, want] of cases) assert.equal(parseAmount(raw, "X"), want, JSON.stringify(raw));
});

test("parseAmount throws on anything that is not a plain amount", () => {
  const bad = [
    "n/a", "abc", "-", "()", "(-50)", "--5", "1.2.3",
    "Infinity", "-Infinity", "NaN", "1e3", "1e999", "0x10", // Number() accepts several of these
    "1.234,50", "1,23", "1,2345.00", ",5", // comma not used as a thousands separator
    "12.5%", "50.00-", "−50.00", // trailing/other minus signs are not guessed at
    NaN, Infinity, -Infinity,
  ];
  for (const raw of bad) {
    assert.throws(() => parseAmount(raw, "Acme"), /Unparseable Acme report amount/, String(raw));
  }
});

// --- netBalance --------------------------------------------------------------

test("netBalance picks the side by the rounded net, so float noise cannot choose one", () => {
  assert.deepEqual(netBalance(0.3, 0.1 + 0.2, "Dr"), { drCr: "Dr", value: 0 }); // 0.30000000000000004: nets to zero, fallback used
  assert.deepEqual(netBalance(0.1, 0.2, "Dr"), { drCr: "Cr", value: 0.1 });
  assert.deepEqual(netBalance(10, 0, "Cr"), { drCr: "Dr", value: 10 });
  assert.deepEqual(netBalance(0, 0, undefined), { drCr: undefined, value: 0 });
});

// --- header totals: the section's own Summary wins over re-summing ------------

const qboData = (name, id, debit, credit) => ({ type: "Data", ColData: [{ value: name, id }, { value: debit }, { value: credit }] });

test("QuickBooks: a section header uses the section's Summary, not the sum of the rows kept", () => {
  // The Summary covers more than the rows we kept (here 100 + 40 debit), so the two differ.
  const report = {
    Rows: {
      Row: [
        {
          type: "Section",
          Header: { ColData: [{ value: "Assets" }] },
          Rows: { Row: [qboData("Checking", "35", "100.00", "")] },
          Summary: { ColData: [{ value: "Total Assets" }, { value: "140.00" }, { value: "" }] },
        },
      ],
    },
  };
  const [header, checking] = quickbooks.buildQuickbooksAccounts([], report);
  assert.equal(header.value, 140);
  assert.equal(header.drCr, "Dr");
  assert.equal(checking.value, 100); // the detail row is unaffected
});

test("QuickBooks: a section without a Summary is totalled from its rows", () => {
  const report = {
    Rows: {
      Row: [
        {
          type: "Section",
          Header: { ColData: [{ value: "Assets" }] },
          Rows: { Row: [qboData("A", "1", "100.00", ""), qboData("B", "2", "", "30.00")] },
        },
      ],
    },
  };
  const [header] = quickbooks.buildQuickbooksAccounts([], report);
  assert.equal(header.value, 70);
  assert.equal(header.drCr, "Dr");
});

const xeroRow = (name, id, ...amounts) => ({
  RowType: "Row",
  Cells: [{ Value: name, Attributes: [{ Id: "account", Value: id }] }, ...amounts.map((Value) => ({ Value }))],
});
const xeroSummary = (...amounts) => ({ RowType: "SummaryRow", Cells: [{ Value: "Total" }, ...amounts.map((Value) => ({ Value }))] });
const xeroReport = (rows) => ({
  Reports: [
    {
      Rows: [
        { RowType: "Header", Cells: ["Account", "Debit", "Credit"].map((Value) => ({ Value })) },
        { RowType: "Section", Title: "Assets", Rows: rows },
      ],
    },
  ],
});

test("Xero: a section header uses the SummaryRow, not the sum of the rows kept", () => {
  const raw = xeroReport([xeroRow("Bank", "b1", "100.00", ""), xeroSummary("140.00", "")]);
  const [header, bank] = xero.buildXeroAccounts([], raw);
  assert.equal(header.value, 140);
  assert.equal(header.drCr, "Dr");
  assert.equal(bank.value, 100);
});

test("Xero: a SummaryRow too short to reach the balance columns is ignored", () => {
  const raw = xeroReport([xeroRow("Bank", "b1", "100.00", ""), { RowType: "SummaryRow", Cells: [{ Value: "Total" }] }]);
  const [header] = xero.buildXeroAccounts([], raw);
  assert.equal(header.value, 100);
});

test("buildAccountRows: a section whose summary nets to zero has no side, even with rows", () => {
  const [header] = buildAccountRows({
    sourceSystem: "xero",
    sections: [{ title: "S", rows: [{ accountId: "a", name: "A", debit: 5, credit: 0 }], summary: { debit: 9, credit: 9 } }],
    dimensionById: new Map(),
    fallbackDrCr: () => "Dr",
    vendorSpecific: () => ({}),
  });
  assert.equal(header.value, 0);
  assert.equal(header.drCr, undefined);
});
