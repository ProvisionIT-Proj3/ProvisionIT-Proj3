const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildXeroAccounts,
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

test("official sample: headers net their section; detail rows total to the grand total on each side", () => {
  const accounts = buildXeroAccounts(ACCOUNTS, OFFICIAL_TRIAL_BALANCE);

  assert.deepEqual(
    accounts.filter((a) => a.isHeader).map((h) => [h.code, h.name, h.drCr, h.value]),
    [
      ["HDR-1", "Revenue", "Cr", 2100.22],
      ["HDR-2", "Expenses", "Dr", 120],
      ["HDR-3", "Assets", "Dr", 45601.51],
      ["HDR-4", "Liabilities", "Cr", 12749.6],
      ["HDR-5", "Equity", "Cr", 30871.69],
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
  const [header, bank, loan] = buildXeroAccounts(ACCOUNTS, raw);

  assert.equal(bank.drCr, "Cr");
  assert.equal(bank.value, 50);
  assert.equal(loan.drCr, "Dr");
  assert.equal(loan.value, 75);
  // Header nets the section: -50 debit, -75 credit -> 25 Dr.
  assert.equal(header.drCr, "Dr");
  assert.equal(header.value, 25);
});

test("zero-balance accounts fall back to the Class-based side; zero-balance headers have none", () => {
  const raw = report([["Assets", [accountRow("Bank", BANK_ID, "", "")]]]);
  const [header, bank] = buildXeroAccounts(ACCOUNTS, raw);

  assert.equal(bank.drCr, "Dr"); // Class ASSET
  assert.equal(bank.value, 0);
  assert.equal(header.drCr, undefined);
  assert.equal(header.value, 0);
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

  assert.deepEqual(ids, ["header:Revenue", "unmatched:Other", "unmatched:Other#2", "header:Revenue#2"]);
});
