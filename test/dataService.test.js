const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");

// dataService.getAccounts must return canonical rows (id/code/name/drCr/...),
// not the raw Xero Accounts/TrialBalance shape (AccountID/Code/Name/...).
// Mock both connector calls so this exercises only the mapping seam.
mock.module("../src/connector/xero/accounts.js", {
  exports: {
    getAccounts: async () => [
      {
        AccountID: "7279b388-6715-4e7b-8f43-d882f4e4615a",
        Code: "200",
        Name: "Sales",
        Type: "REVENUE",
        Class: "REVENUE",
        TaxType: "OUTPUT",
      },
    ],
  },
});

mock.module("../src/connector/xero/trialBalance.js", {
  exports: {
    getTrialBalance: async () => ({
      ReportID: "TrialBalance",
      Rows: [
        {
          RowType: "Section",
          Title: "Revenue",
          Rows: [
            {
              RowType: "Row",
              Cells: [
                {
                  Value: "Sales",
                  Attributes: [{ Id: "account", Value: "7279b388-6715-4e7b-8f43-d882f4e4615a" }],
                },
                { Value: "" },
                { Value: "500.00" },
                { Value: "" },
                { Value: "500.00" },
              ],
            },
            {
              RowType: "SummaryRow",
              Cells: [{ Value: "Total Revenue" }, { Value: "" }, { Value: "500.00" }],
            },
          ],
        },
      ],
    }),
  },
});

const dataService = require("../src/services/dataService");

test("getAccounts returns canonical account rows, not raw Xero fields", async () => {
  const result = await dataService.getAccounts("11111111-1111-1111-1111-111111111111");

  assert.equal(result.data.length, 2); // synthesized section header + the one detail row
  assert.equal(result.pagination.totalItems, 2);

  const [header, detail] = result.data;

  assert.equal(header.isHeader, true);
  assert.equal(header.name, "Revenue");
  assert.equal(header.sourceSystem, "xero");

  assert.equal(detail.isHeader, false);
  assert.equal(detail.id, "7279b388-6715-4e7b-8f43-d882f4e4615a");
  assert.equal(detail.name, "Sales");
  assert.equal(detail.drCr, "Cr");
  assert.equal(detail.value, 500);
  assert.equal(detail.taxCode, "GST");
  assert.equal(detail.sourceSystem, "xero");

  // Raw Xero field names must not leak through.
  assert.equal(detail.AccountID, undefined);
  assert.equal(detail.Code, undefined);
});
