const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuickbooksAccounts,
  mapQuickbooksAccountDimension,
  mapQuickbooksTaxCode,
  parseTrialBalanceReport,
  getQuickbooksReportDate,
} = require("../src/mappers/quickbooks/accountMapper");

// TaxCode ids differ per QBO company; the mapper resolves them by name.
const RAW_TAX_CODES = [
  { Id: "2", Name: "GST" },
  { Id: "3", Name: "Out of Scope" },
  { Id: "9", Name: "Input tax" },
];
const TAX_CODE_NAMES = new Map(RAW_TAX_CODES.map((t) => [t.Id, t.Name]));

const RAW_ACCOUNTS = [
  {
    Id: "79",
    AcctNum: "",
    Name: "Sales",
    AccountType: "Income",
    Classification: "Revenue",
    TaxCodeRef: { value: "2" },
  },
  {
    Id: "35",
    AcctNum: "1000",
    Name: "Checking",
    AccountType: "Bank",
    Classification: "Asset",
    TaxCodeRef: { value: "3" },
  },
];

const RAW_TRIAL_BALANCE = {
  Header: { ReportName: "TrialBalance" },
  Columns: {
    Column: [{ ColType: "Account" }, { ColType: "Money" }, { ColType: "Money" }],
  },
  Rows: {
    Row: [
      {
        type: "Section",
        group: "Income",
        Header: { ColData: [{ value: "Revenue" }, { value: "" }, { value: "" }] },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [{ value: "Sales", id: "79" }, { value: "" }, { value: "500.00" }],
            },
          ],
        },
        Summary: {
          ColData: [{ value: "Total Revenue" }, { value: "" }, { value: "500.00" }],
        },
      },
      {
        type: "Section",
        group: "Assets",
        Header: { ColData: [{ value: "Asset" }, { value: "" }, { value: "" }] },
        Rows: {
          Row: [
            {
              type: "Data",
              ColData: [{ value: "Checking", id: "35" }, { value: "0.00" }, { value: "" }],
            },
          ],
        },
        // No Summary row — exercises the sum-of-detail-rows fallback.
      },
    ],
  },
};

test("buildQuickbooksAccounts returns canonical account rows, not raw QBO fields", () => {
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, RAW_TRIAL_BALANCE, RAW_TAX_CODES);

  // 2 sections x (1 header + 1 detail) = 4 rows
  assert.equal(accounts.length, 4);

  const [revenueHeader, sales, assetHeader, checking] = accounts;

  assert.equal(revenueHeader.isHeader, true);
  assert.equal(revenueHeader.name, "Revenue");
  assert.equal(revenueHeader.code, "HDR-1");
  assert.equal(revenueHeader.level, 1);
  assert.equal(revenueHeader.drCr, "Cr");
  assert.equal(revenueHeader.value, 500);
  assert.equal(revenueHeader.sourceSystem, "quickbooks");

  assert.equal(sales.isHeader, false);
  assert.equal(sales.id, "79");
  assert.equal(sales.name, "Sales");
  assert.equal(sales.code, "79"); // AcctNum blank -> substituted with Id
  assert.equal(sales.type, "Income");
  assert.equal(sales.drCr, "Cr");
  assert.equal(sales.value, 500);
  assert.equal(sales.taxCode, "GST");
  assert.equal(sales.sourceSystem, "quickbooks");

  // Raw QBO field names must not leak through.
  assert.equal(sales.Id, undefined);
  assert.equal(sales.AcctNum, undefined);
  assert.equal(sales.AccountType, undefined);

  assert.equal(assetHeader.name, "Asset");
  assert.equal(assetHeader.code, "HDR-2");
  // No Summary row: header value/drCr fall back to summing detail rows (0.00 debit, 0 credit).
  assert.equal(assetHeader.value, 0);

  assert.equal(checking.code, "1000"); // AcctNum present -> used directly
  assert.equal(checking.type, "Bank");
  // Zero balance on both sides: falls back to the Classification-based lookup (Asset -> Dr).
  assert.equal(checking.drCr, "Dr");
  assert.equal(checking.taxCode, "N-T");
});

test("mapQuickbooksAccountDimension substitutes Id for a blank AcctNum", () => {
  const dimension = mapQuickbooksAccountDimension({ Id: "79", AcctNum: "", Name: "Sales" });
  assert.equal(dimension.code, "79");

  const withAcctNum = mapQuickbooksAccountDimension({ Id: "35", AcctNum: "1000", Name: "Checking" });
  assert.equal(withAcctNum.code, "1000");
});

test("mapQuickbooksTaxCode resolves TaxCodeRef by tax code name, not by id", () => {
  assert.equal(mapQuickbooksTaxCode({ value: "2" }, TAX_CODE_NAMES), "GST");
  assert.equal(mapQuickbooksTaxCode({ value: "3" }, TAX_CODE_NAMES), "N-T");
  // Known id, name with no client code: the name is passed through.
  assert.equal(mapQuickbooksTaxCode({ value: "9" }, TAX_CODE_NAMES), "UNMAPPED:Input tax");
  // Id not in this company's TaxCode list.
  assert.equal(mapQuickbooksTaxCode({ value: "17" }, TAX_CODE_NAMES), "UNMAPPED:17");
  // Another company where id 2 is something else must not come out as GST.
  assert.equal(mapQuickbooksTaxCode({ value: "2" }, new Map([["2", "GST free"]])), "FRE");
  assert.equal(mapQuickbooksTaxCode(undefined, TAX_CODE_NAMES), undefined);
});

// QBO's real TrialBalance response: flat Data rows, then a title-less GrandTotal section.
const FLAT_TRIAL_BALANCE = {
  Rows: {
    Row: [
      { type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "500.00" }, { value: "" }] },
      { type: "Data", ColData: [{ value: "Sales", id: "79" }, { value: "" }, { value: "500.00" }] },
      {
        type: "Section",
        group: "GrandTotal",
        Summary: { ColData: [{ value: "TOTAL" }, { value: "500.00" }, { value: "500.00" }] },
      },
    ],
  },
};

test("parseTrialBalanceReport handles flat account rows and ignores the GrandTotal section", () => {
  const sections = parseTrialBalanceReport(FLAT_TRIAL_BALANCE);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Accounts");
  assert.deepEqual(
    sections[0].rows.map((r) => [r.accountId, r.debit, r.credit]),
    [
      ["35", 500, 0],
      ["79", 0, 500],
    ]
  );
});

test("buildQuickbooksAccounts maps a flat trial balance to a header plus detail rows", () => {
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, FLAT_TRIAL_BALANCE, RAW_TAX_CODES);

  assert.equal(accounts.length, 3);
  assert.equal(accounts[0].isHeader, true);
  // The flat "Accounts" header holds both sides, which net to zero: no side, value 0.
  assert.equal(accounts[0].value, 0);
  assert.equal(accounts[0].drCr, undefined);
  assert.equal(accounts[1].name, "Checking");
  assert.equal(accounts[1].drCr, "Dr");
  assert.equal(accounts[2].name, "Sales");
  assert.equal(accounts[2].drCr, "Cr");
  assert.equal(accounts.some((a) => a.id === "header:undefined"), false);
});

test("negative amounts flip the side instead of reporting a zero balance", () => {
  const report = {
    Rows: {
      Row: [
        { type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "-50.00" }, { value: "" }] },
        { type: "Data", ColData: [{ value: "Sales", id: "79" }, { value: "" }, { value: "(75.00)" }] },
      ],
    },
  };
  const [, checking, sales] = buildQuickbooksAccounts(RAW_ACCOUNTS, report);

  assert.equal(checking.drCr, "Cr");
  assert.equal(checking.value, 50);
  assert.equal(sales.drCr, "Dr");
  assert.equal(sales.value, 75);
});

test("amounts with thousands separators parse; garbage amounts throw rather than become 0", () => {
  const withComma = {
    Rows: { Row: [{ type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "1,234.50" }, { value: "" }] }] },
  };
  assert.equal(parseTrialBalanceReport(withComma)[0].rows[0].debit, 1234.5);

  const garbage = {
    Rows: { Row: [{ type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "n/a" }, { value: "" }] }] },
  };
  assert.throws(() => parseTrialBalanceReport(garbage), /Unparseable QuickBooks report amount/);
});

test("repeated ids get a #n suffix so one sync can't hit the unique (connection, id) constraint", () => {
  const report = {
    Rows: {
      Row: [
        { type: "Section", Header: { ColData: [{ value: "Revenue" }] }, Rows: { Row: [
          { type: "Data", ColData: [{ value: "Mystery" }, { value: "" }, { value: "10.00" }] },
          { type: "Data", ColData: [{ value: "Mystery" }, { value: "" }, { value: "20.00" }] },
        ] } },
        { type: "Section", Header: { ColData: [{ value: "Revenue" }] }, Rows: { Row: [] } },
      ],
    },
  };
  const ids = buildQuickbooksAccounts([], report).map((a) => a.id);

  assert.deepEqual(ids, ["header:Revenue", "unmatched:Mystery", "unmatched:Mystery#2", "header:Revenue#2"]);
});

test("a flat row with no account id is kept as an unmatched row, not dropped", () => {
  const report = {
    Rows: {
      Row: [
        { type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "500.00" }, { value: "" }] },
        { type: "Data", ColData: [{ value: "Mystery" }, { value: "" }, { value: "500.00" }] },
      ],
    },
  };
  const [, checking, mystery] = buildQuickbooksAccounts(RAW_ACCOUNTS, report);

  assert.equal(mystery.id, "unmatched:Mystery");
  assert.equal(mystery.name, "Mystery");
  assert.equal(mystery.drCr, "Cr");
  assert.equal(mystery.value, 500);
  assert.equal(mystery._vendorSpecific.matchedToAccountsList, false);
  assert.equal(checking.value, 500); // the report still balances
});

test("an id-less total line is not counted as an account, flat or nested", () => {
  const totals = [
    { type: "Data", ColData: [{ value: "TOTAL" }, { value: "500.00" }, { value: "500.00" }] },
    { type: "Data", ColData: [{ value: "Total Assets" }, { value: "500.00" }, { value: "" }] },
    { type: "Data", ColData: [{ value: "  total: revenue" }, { value: "" }, { value: "500.00" }] },
  ];
  const checking = { type: "Data", ColData: [{ value: "Checking", id: "35" }, { value: "500.00" }, { value: "" }] };

  const flat = buildQuickbooksAccounts(RAW_ACCOUNTS, { Rows: { Row: [checking, ...totals] } });
  assert.deepEqual(flat.map((a) => a.name), ["Accounts", "Checking"]);
  assert.equal(flat[0].value, 500); // not inflated by the total lines

  const nested = buildQuickbooksAccounts(RAW_ACCOUNTS, {
    Rows: { Row: [{ type: "Section", Header: { ColData: [{ value: "Assets" }] }, Rows: { Row: [checking, ...totals] } }] },
  });
  assert.deepEqual(nested.map((a) => a.name), ["Assets", "Checking"]);
});

test("the total-line guard never drops a row that has an id, or an account that merely starts with 'Total'", () => {
  const report = {
    Rows: {
      Row: [
        // Has an id, so it is an account even though it is named like a total.
        { type: "Data", ColData: [{ value: "Total Loss Reserve", id: "50" }, { value: "10.00" }, { value: "" }] },
        // Starts with the letters but is a different word.
        { type: "Data", ColData: [{ value: "Totalizer Fees" }, { value: "5.00" }, { value: "" }] },
      ],
    },
  };
  const names = buildQuickbooksAccounts([], report).filter((a) => !a.isHeader).map((a) => a.name);

  assert.deepEqual(names, ["Total Loss Reserve", "Totalizer Fees"]);
});

test("getQuickbooksReportDate reads Header.EndPeriod", () => {
  assert.equal(getQuickbooksReportDate({ Header: { EndPeriod: "2026-06-30" } }), "2026-06-30");
  assert.equal(getQuickbooksReportDate({ Header: {} }), null);
  assert.equal(getQuickbooksReportDate(undefined), null);
});
