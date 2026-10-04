const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuickbooksAccounts,
  mapQuickbooksAccountDimension,
  mapQuickbooksTaxCode,
} = require("../src/mappers/quickbooks/accountMapper");

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
  const accounts = buildQuickbooksAccounts(RAW_ACCOUNTS, RAW_TRIAL_BALANCE);

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

test("mapQuickbooksTaxCode passes unmapped TaxCodeRef values through as UNMAPPED:<value>", () => {
  assert.equal(mapQuickbooksTaxCode({ value: "2" }), "GST");
  assert.equal(mapQuickbooksTaxCode({ value: "3" }), "N-T");
  assert.equal(mapQuickbooksTaxCode({ value: "17" }), "UNMAPPED:17");
  assert.equal(mapQuickbooksTaxCode(undefined), undefined);
});
