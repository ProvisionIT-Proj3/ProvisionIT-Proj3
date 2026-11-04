const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildXeroAccounts,
  classifyXeroAccount,
  getXeroReportDate,
  parseTrialBalanceReport,
} = require("../src/mappers/xero/accountMapper");

// Xero's own published example (see test/fixtures/README.md) plus a matching
// GET /Accounts response.
const OFFICIAL_TRIAL_BALANCE = require("./fixtures/xero/trial_balance.official.json");
const { Accounts: ACCOUNTS } = require("./fixtures/xero/accounts.json");

const round2 = (n) => Math.round(n * 100) / 100;
const grandTotal = () => {
  const totalSection = OFFICIAL_TRIAL_BALANCE.Reports[0].Rows.find((r) => r.RowType === "Section" && !r.Title);
  const cells = totalSection.Rows[0].Cells;
  return { ytdDebit: Number(cells[3].Value), ytdCredit: Number(cells[4].Value) };
};

// Small hand-built reports for edge cases; the Header row names the columns.
const accountRow = (name, id, debit, credit) => ({
  RowType: "Row",
  Cells: [
    { Value: name, Attributes: id ? [{ Id: "account", Value: id }] : undefined },
    { Value: debit },
    { Value: credit },
  ],
});
const report = (sections) => ({
  Reports: [
    {
      Rows: [
        { RowType: "Header", Cells: [{ Value: "Account" }, { Value: "Debit" }, { Value: "Credit" }] },
        ...sections.map(([Title, Rows]) => ({ RowType: "Section", Title, Rows })),
      ],
    },
  ],
});
const BANK_ID = ACCOUNTS.find((a) => a.Code === "088").AccountID; // Business Wells Fargo, Class ASSET

test("official sample: the title-less grand-total section is not turned into a header", () => {
  const sections = parseTrialBalanceReport(OFFICIAL_TRIAL_BALANCE);

  assert.deepEqual(
    sections.map((s) => [s.title, s.rows.length]),
    [
      ["Revenue", 3],
      ["Expenses", 2],
      ["Assets", 7],
      ["Liabilities", 6],
      ["Equity", 1],
    ]
  );
});

test("official sample: balances come from the YTD columns and add up to Xero's grand total", () => {
  const rows = parseTrialBalanceReport(OFFICIAL_TRIAL_BALANCE).flatMap((s) => s.rows);
  const { ytdDebit, ytdCredit } = grandTotal();

  assert.equal(round2(rows.reduce((sum, r) => sum + r.debit, 0)), ytdDebit); // 46019.00
  assert.equal(round2(rows.reduce((sum, r) => sum + r.credit, 0)), ytdCredit); // 46019.00
});

test("official sample: balance-sheet accounts carry their as-at balance, not the month's movement", () => {
  const byCode = new Map(buildXeroAccounts(ACCOUNTS, OFFICIAL_TRIAL_BALANCE).map((a) => [a.code, a]));
  const check = (code, drCr, value) => {
    assert.equal(byCode.get(code).drCr, drCr, `${code} drCr`);
    assert.equal(byCode.get(code).value, value, `${code} value`);
  };

  check("088", "Dr", 7639.04); // bank: Debit column 0.00, YTD Debit 7639.04
  check("120", "Dr", 36555.04); // receivables: Debit column 1190.00 is only this month
  check("200", "Cr", 9223); // payables: Credit column 0.00
  check("320", "Cr", 30871.69); // retained earnings: Credit column blank
  check("1400", "Cr", 160); // inventory with a credit balance
  check("250", "Dr", 41); // suspense (a liability) with a debit balance
  check("400", "Cr", 1020.22);
});

test("official sample: headers are built from Class/Type and net their members; detail rows total to the grand total on each side", () => {
  const accounts = buildXeroAccounts(ACCOUNTS, OFFICIAL_TRIAL_BALANCE);

  assert.deepEqual(
    accounts.filter((a) => a.isHeader).map((h) => [h.code, h.name, h.level, h.drCr, h.value]),
    [
      ["1-0000", "Assets", 1, "Dr", 45601.51],
      ["1-1000", "Current Assets", 2, "Dr", 45601.51],
      ["2-0000", "Liabilities", 1, "Cr", 12749.6],
      ["2-1000", "Current Liabilities", 2, "Cr", 12749.6],
      ["3-0000", "Equity", 1, "Cr", 30871.69],
      ["4-0000", "Income", 1, "Cr", 2100.22],
      ["6-0000", "Expenses", 1, "Dr", 120],
    ]
  );

  // Each account has a balance on one side only, so per side the detail rows
  // reproduce Xero's grand total (headers net Dr against Cr, so they don't).
  const details = accounts.filter((a) => !a.isHeader);
  const side = (s) => round2(details.filter((a) => a.drCr === s).reduce((sum, a) => sum + a.value, 0));
  const { ytdDebit, ytdCredit } = grandTotal();
  assert.equal(side("Dr"), ytdDebit);
  assert.equal(side("Cr"), ytdCredit);
});

test("official sample: detail rows take code, name, type and tax code from GET /Accounts", () => {
  const accounts = buildXeroAccounts(ACCOUNTS, OFFICIAL_TRIAL_BALANCE).filter((a) => !a.isHeader);
  assert.equal(accounts.length, 19);
  assert.ok(accounts.every((a) => a._vendorSpecific.matchedToAccountsList));

  const sales = accounts.find((a) => a.code === "400");
  assert.equal(sales.id, "02439bca-5fdc-4b62-b281-0bdf9f16fd5b");
  assert.equal(sales.name, "Sales"); // the report cell says "Sales (400)"
  assert.equal(sales.type, "REVENUE");
  assert.equal(sales.taxCode, "GST");
  assert.equal(sales.sourceSystem, "xero");

  const bank = accounts.find((a) => a.code === "088");
  assert.equal(bank.type, "BANK");
  assert.equal(bank.taxCode, "N-T");
});

test("official sample: unmatched rows fall back to the report's own account name", () => {
  const accounts = buildXeroAccounts([], OFFICIAL_TRIAL_BALANCE).filter((a) => !a.isHeader);
  const sales = accounts.find((a) => a.id === "02439bca-5fdc-4b62-b281-0bdf9f16fd5b");

  assert.equal(sales.name, "Sales (400)");
  assert.equal(sales.code, undefined);
  assert.equal(sales._vendorSpecific.matchedToAccountsList, false);
});

test("getXeroReportDate reads the report's own as-at date", () => {
  assert.equal(getXeroReportDate(OFFICIAL_TRIAL_BALANCE), "2019-04-24");
  assert.equal(getXeroReportDate({ Reports: [{ ReportDate: "1 Feb 2026" }] }), "2026-02-01");
  assert.equal(getXeroReportDate({ Reports: [{ ReportDate: "sometime" }] }), null);
  assert.equal(getXeroReportDate({ Reports: [] }), null);
});

test("without a Header row the YTD columns are still used", () => {
  const raw = {
    Reports: [
      {
        Rows: [
          {
            RowType: "Section",
            Title: "Assets",
            Rows: [
              {
                RowType: "Row",
                Cells: [
                  { Value: "Bank", Attributes: [{ Id: "account", Value: BANK_ID }] },
                  { Value: "5.00" },
                  { Value: "" },
                  { Value: "500.00" },
                  { Value: "" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(parseTrialBalanceReport(raw)[0].rows[0].debit, 500);
});

test("negative amounts flip the side instead of reporting a zero balance", () => {
  const raw = report([["Assets", [accountRow("Bank", BANK_ID, "-50.00", ""), accountRow("Loan", "acc-x", "", "(75.00)")]]]);
  const rows = buildXeroAccounts(ACCOUNTS, raw);
  const [bank, loan] = [BANK_ID, "acc-x"].map((id) => rows.find((r) => r.id === id));
  const header = (id) => rows.find((r) => r.id === id);

  assert.equal(bank.drCr, "Cr");
  assert.equal(bank.value, 50);
  assert.equal(loan.drCr, "Dr");
  assert.equal(loan.value, 75);
  // Each header nets its own members: Assets holds the bank (-50 debit), Unclassified the unmatched loan (-75 credit).
  assert.equal(header("header:asset").drCr, "Cr");
  assert.equal(header("header:asset").value, 50);
  assert.equal(header("header:unclassified").drCr, "Dr");
  assert.equal(header("header:unclassified").value, 75);
});

test("zero-balance accounts fall back to the Class-based side; zero-balance headers take their group's normal side", () => {
  const raw = report([["Assets", [accountRow("Bank", BANK_ID, "", "")]]]);
  const rows = buildXeroAccounts(ACCOUNTS, raw);
  const bank = rows.find((r) => !r.isHeader);

  assert.equal(bank.drCr, "Dr"); // Class ASSET
  assert.equal(bank.value, 0);
  assert.ok(rows.filter((r) => r.isHeader).every((h) => h.drCr === "Dr" && h.value === 0));
});

test("amounts with thousands separators parse; garbage amounts throw rather than become 0", () => {
  const withComma = report([["Assets", [accountRow("Bank", BANK_ID, "1,234.50", "")]]]);
  assert.equal(parseTrialBalanceReport(withComma)[0].rows[0].debit, 1234.5);

  const garbage = report([["Assets", [accountRow("Bank", BANK_ID, "n/a", "")]]]);
  assert.throws(() => parseTrialBalanceReport(garbage), /Unparseable Xero report amount/);
});

test("repeated section titles and unmatched names get unique ids", () => {
  const raw = report([
    ["Revenue", [accountRow("Other", null, "", "1.00"), accountRow("Other", null, "", "2.00")]],
    ["Revenue", []],
  ]);
  const ids = buildXeroAccounts([], raw).map((a) => a.id);

  assert.deepEqual(ids, ["header:unclassified", "unmatched:Other", "unmatched:Other#2"]);
});

test("classifyXeroAccount uses Type, falls back to Class, else is unclassified", () => {
  assert.deepEqual(classifyXeroAccount({ type: "TERMLIAB", class: "LIABILITY" }), ["liability", "nonCurrentLiability"]);
  assert.deepEqual(classifyXeroAccount({ type: "DIRECTCOSTS", class: "EXPENSE" }), ["costOfSales"]);
  assert.deepEqual(classifyXeroAccount({ type: "OTHERINCOME", class: "REVENUE" }), ["otherIncome"]);
  assert.deepEqual(classifyXeroAccount({ type: "BRAND_NEW_TYPE", class: "ASSET" }), ["asset"]);
  assert.equal(classifyXeroAccount({}), undefined);
});

test("every Type in the sample GET /Accounts response is placed under a real group", () => {
  const unplaced = ACCOUNTS.filter((a) => !classifyXeroAccount({ type: a.Type, class: a.Class }));
  assert.deepEqual(unplaced, []);
});
