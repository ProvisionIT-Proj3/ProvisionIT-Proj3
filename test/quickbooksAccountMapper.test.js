const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuickbooksAccounts,
  classifyQuickbooksAccount,
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

  // Assets > Current Assets > Checking, then Income > Sales. The report's own
  // sections ("Revenue", "Asset") don't decide the headers; the accounts' types do.
  assert.deepEqual(
    accounts.map((a) => [a.code, a.name, a.level]),
    [
      ["1-0000", "Assets", 1],
      ["1-1000", "Current Assets", 2],
      ["1000", "Checking", 3],
      ["4-0000", "Income", 1],
      ["79", "Sales", 2],
    ]
  );
  const [assets, currentAssets, checking, income, sales] = accounts;

  assert.equal(assets.isHeader, true);
  assert.equal(assets.type, "Asset");
  assert.equal(assets.sourceSystem, "quickbooks");
  // Checking is 0.00 on both sides, so the header takes its group's normal side.
  assert.equal(assets.value, 0);
  assert.equal(assets.drCr, "Dr");
  assert.equal(currentAssets.value, 0);

  assert.equal(income.isHeader, true);
  assert.equal(income.drCr, "Cr");
  assert.equal(income.value, 500);

  assert.equal(sales.isHeader, false);
  assert.equal(sales.id, "79");
  assert.equal(sales.name, "Sales");
  assert.equal(sales.code, "79"); // AcctNum blank -> substituted with Id
  assert.equal(sales.type, "Income");
  assert.equal(sales.drCr, "Cr");
  assert.equal(sales.value, 500);
  assert.equal(sales.taxCode, "GST");
  assert.equal(sales.sourceSystem, "quickbooks");
  assert.equal(sales._vendorSpecific.reportSection, "Revenue"); // kept for traceability only

  // Raw QBO field names must not leak through.
  assert.equal(sales.Id, undefined);
  assert.equal(sales.AcctNum, undefined);
  assert.equal(sales.AccountType, undefined);

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

test("buildQuickbooksAccounts gives a flat trial balance real headers, grouped by account type", () => {
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, FLAT_TRIAL_BALANCE, RAW_TAX_CODES);

  assert.deepEqual(
    accounts.map((a) => [a.name, a.isHeader, a.drCr, a.value]),
    [
      ["Assets", true, "Dr", 500],
      ["Current Assets", true, "Dr", 500],
      ["Checking", false, "Dr", 500],
      ["Income", true, "Cr", 500],
      ["Sales", false, "Cr", 500],
    ]
  );
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
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, report);
  const checking = accounts.find((a) => a.name === "Checking");
  const sales = accounts.find((a) => a.name === "Sales");

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

  // No Account list, so nothing can be classified: one Unclassified header, however many sections.
  assert.deepEqual(ids, ["header:unclassified", "unmatched:Mystery", "unmatched:Mystery#2"]);
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
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, report);
  const checking = accounts.find((a) => a.name === "Checking");
  const mystery = accounts.find((a) => a.name === "Mystery");

  const unclassified = accounts.find((a) => a.id === "header:unclassified"); // holds Mystery only
  assert.equal(unclassified.value, 500);
  assert.equal(unclassified.drCr, "Cr");
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
  assert.deepEqual(flat.map((a) => a.name), ["Assets", "Current Assets", "Checking"]);
  assert.equal(flat[0].value, 500); // not inflated by the total lines

  const nested = buildQuickbooksAccounts(RAW_ACCOUNTS, {
    Rows: { Row: [{ type: "Section", Header: { ColData: [{ value: "Assets" }] }, Rows: { Row: [checking, ...totals] } }] },
  });
  assert.deepEqual(nested.map((a) => a.name), ["Assets", "Current Assets", "Checking"]);
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

test("sub-accounts sit a level deeper per level of the QBO account tree", () => {
  const accounts = [
    { Id: "1", Name: "Utilities", FullyQualifiedName: "Utilities", AccountType: "Expense", Classification: "Expense" },
    { Id: "2", Name: "Electricity", FullyQualifiedName: "Utilities:Electricity", SubAccount: true, ParentRef: { value: "1" }, AccountType: "Expense", Classification: "Expense" },
    { Id: "3", Name: "Solar", FullyQualifiedName: "Utilities:Electricity:Solar", SubAccount: true, ParentRef: { value: "2" }, AccountType: "Expense", Classification: "Expense" },
    { Id: "4", Name: "Water", SubAccount: true, ParentRef: { value: "1" }, AccountType: "Expense", Classification: "Expense" }, // no FullyQualifiedName
  ];
  const data = (name, id) => ({ type: "Data", ColData: [{ value: name, id }, { value: "10.00" }, { value: "" }] });
  const report = { Rows: { Row: [data("Utilities", "1"), data("Electricity", "2"), data("Solar", "3"), data("Water", "4")] } };

  const rows = buildQuickbooksAccounts(accounts, report);
  assert.deepEqual(rows.map((r) => [r.name, r.level]), [["Expenses", 1], ["Utilities", 2], ["Electricity", 3], ["Solar", 4], ["Water", 3]]);
  assert.equal(rows.find((r) => r.id === "3")._vendorSpecific.parentId, "2");
  assert.equal(rows[0].value, 40); // the header totals every account once, parents and sub-accounts alike
});

test("classifyQuickbooksAccount uses AccountType, falls back to Classification, else is unclassified", () => {
  assert.deepEqual(classifyQuickbooksAccount({ type: "Long Term Liability", classification: "Liability" }), ["liability", "nonCurrentLiability"]);
  assert.deepEqual(classifyQuickbooksAccount({ type: "Cost of Goods Sold" }), ["costOfSales"]);
  assert.deepEqual(classifyQuickbooksAccount({ type: "Some New Type", classification: "Asset" }), ["asset"]);
  assert.equal(classifyQuickbooksAccount({}), undefined);
});

test("getQuickbooksReportDate reads Header.EndPeriod", () => {
  assert.equal(getQuickbooksReportDate({ Header: { EndPeriod: "2026-06-30" } }), "2026-06-30");
  assert.equal(getQuickbooksReportDate({ Header: {} }), null);
  assert.equal(getQuickbooksReportDate(undefined), null);
});
