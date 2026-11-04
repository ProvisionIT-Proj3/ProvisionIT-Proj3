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
    "9".repeat(400), `-${"9".repeat(400)}`, // plain digits that overflow to Infinity
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

test("QuickBooks: a header is totalled from the rows kept, ignoring the section's own Summary", () => {
  // The vendor's Summary describes the vendor's section, not our group, so it plays no part.
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
  assert.equal(header.value, 100);
  assert.equal(header.drCr, "Dr");
  assert.equal(checking.value, 100);
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

test("Xero: a header is totalled from the rows kept, ignoring any SummaryRow", () => {
  const raw = xeroReport([xeroRow("Bank", "b1", "100.00", ""), xeroSummary("140.00", "")]);
  const [header, bank] = xero.buildXeroAccounts([], raw);
  assert.equal(header.value, 100);
  assert.equal(header.drCr, "Dr");
  assert.equal(bank.value, 100);
});

test("Xero: a SummaryRow too short to reach the balance columns is ignored", () => {
  const raw = xeroReport([xeroRow("Bank", "b1", "100.00", ""), { RowType: "SummaryRow", Cells: [{ Value: "Total" }] }]);
  const [header] = xero.buildXeroAccounts([], raw);
  assert.equal(header.value, 100);
});

const buildOne = (dimension, classify) =>
  buildAccountRows({
    sourceSystem: "xero",
    sections: [{ title: "S", rows: [{ accountId: "a", name: "A", debit: 5, credit: 0 }] }],
    dimensionById: new Map([["a", { id: "a", code: "1", name: "A", ...dimension }]]),
    classify,
    fallbackDrCr: () => "Dr",
    vendorSpecific: () => ({}),
  });

test("buildAccountRows: group, subgroup and detail rows nest with MYOB-style codes and levels", () => {
  const rows = buildOne({}, () => ["asset", "fixedAsset"]);

  assert.deepEqual(
    rows.map((r) => [r.code, r.name, r.type, r.isHeader, r.level, r.drCr, r.value]),
    [
      ["1-0000", "Assets", "Asset", true, 1, "Dr", 5],
      ["1-4000", "Fixed Assets", "Asset", true, 2, "Dr", 5],
      ["1", "A", undefined, false, 3, "Dr", 5],
    ]
  );
});

test("buildAccountRows: a group with no subgroup puts its accounts one level under the group header", () => {
  const rows = buildOne({}, () => ["equity"]);
  assert.deepEqual(rows.map((r) => [r.name, r.level]), [["Equity", 1], ["A", 2]]);
});

test("buildAccountRows: an unknown group or subgroup is handled, not dropped", () => {
  const unknownGroup = buildOne({}, () => ["nonsense"]);
  assert.deepEqual(unknownGroup.map((r) => [r.code, r.level]), [["UNCLASSIFIED", 1], ["1", 2]]);

  const wrongParent = buildOne({}, () => ["asset", "currentLiability"]); // subgroup belongs to liability
  assert.deepEqual(wrongParent.map((r) => [r.name, r.level]), [["Assets", 1], ["A", 2]]);

  const none = buildOne({}, () => undefined);
  assert.equal(none[0].id, "header:unclassified");
});

test("buildAccountRows: an account's depth in the vendor tree pushes its level down", () => {
  const rows = buildOne({ depth: 2 }, () => ["expense"]);
  assert.equal(rows.at(-1).level, 4); // header 1 + 1 + depth 2
});

test("buildAccountRows: groups come out in chart order whatever order the report lists them", () => {
  const rows = buildAccountRows({
    sourceSystem: "xero",
    sections: [{ title: "S", rows: [
      { accountId: "e", name: "E", debit: 1, credit: 0 },
      { accountId: "a", name: "A", debit: 2, credit: 0 },
      { accountId: "x", name: "X", debit: 3, credit: 0 },
    ] }],
    dimensionById: new Map([
      ["e", { id: "e", name: "E", group: ["expense"] }],
      ["a", { id: "a", name: "A", group: ["asset", "currentAsset"] }],
    ]),
    classify: (d) => d.group,
    fallbackDrCr: () => undefined,
    vendorSpecific: () => ({}),
  });

  assert.deepEqual(
    rows.filter((r) => r.isHeader).map((r) => r.code),
    ["1-0000", "1-1000", "6-0000", "UNCLASSIFIED"]
  );
});

test("buildAccountRows: a header netting to zero takes its group's normal side; an unclassified one has none", () => {
  const net = (classify) =>
    buildAccountRows({
      sourceSystem: "xero",
      sections: [{ title: "S", rows: [{ accountId: "a", name: "A", debit: 5, credit: 5 }] }],
      dimensionById: new Map(),
      classify,
      fallbackDrCr: () => "Dr",
      vendorSpecific: () => ({}),
    })[0];

  assert.equal(net(() => ["liability"]).drCr, "Cr");
  assert.equal(net(() => undefined).drCr, undefined);
  assert.equal(net(() => ["liability"]).value, 0);
});
