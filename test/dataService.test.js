const test = require("node:test");
const assert = require("node:assert/strict");
const { inject } = require("./helpers/inject");

// syncAccounts must hand canonical rows (id/code/name/drCr/...) to the
// database, not the raw Xero Accounts/TrialBalance shape (AccountID/Code/Name/...).
// Connection resolution is faked as "xero", and so are both Xero calls and
// the database, so this exercises only the mapping seam.
inject("../src/auth/index.js", {
  registry: { resolveProvider: async () => "xero" },
});

const saved = [];
inject("../src/persistence.js", {
  saveAccounts: async (connectionId, accounts, reportDate) => {
    saved.push({ connectionId, accounts, reportDate });
    return { saved: accounts.length };
  },
});

inject("../src/connector/xero/accounts.js", {
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
});

inject("../src/connector/xero/trialBalance.js", {
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
});

const dataService = require("../src/services/dataService");

test("syncAccounts stores canonical account rows, not raw Xero fields", async () => {
  saved.length = 0;
  const connectionId = "11111111-1111-1111-1111-111111111111";
  const result = await dataService.syncAccounts(connectionId);

  assert.equal(saved.length, 1);
  assert.equal(saved[0].connectionId, connectionId);
  assert.match(saved[0].reportDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.data.saved, 2);

  const [header, detail] = saved[0].accounts; // synthesized section header + the one detail row

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
