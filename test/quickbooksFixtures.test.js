const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildQuickbooksAccounts,
  getQuickbooksReportDate,
  mapQuickbooksAccountDimension,
  mapQuickbooksTaxCode,
  parseTrialBalanceReport,
} = require("../src/mappers/quickbooks/accountMapper");

// Intuit's own published samples, and a consistent AU company built in the
// same shapes (see test/fixtures/README.md).
const OFFICIAL_TRIAL_BALANCE = require("./fixtures/quickbooks/trial_balance.official.json");
const OFFICIAL_ACCOUNTS = require("./fixtures/quickbooks/account_query.official.json").QueryResponse.Account;
const OFFICIAL_TAX_CODES = require("./fixtures/quickbooks/taxcode_query.official.json").QueryResponse.TaxCode;

const AU_TRIAL_BALANCE = require("./fixtures/quickbooks/au_company/trial_balance.json");
const AU_ACCOUNTS = require("./fixtures/quickbooks/au_company/account_query.json").QueryResponse.Account;
const AU_TAX_CODES = require("./fixtures/quickbooks/au_company/taxcode_query.json").QueryResponse.TaxCode;

const round2 = (n) => Math.round(n * 100) / 100;
const grandTotal = (report) => {
  const cells = report.Rows.Row.find((r) => r.group === "GrandTotal").Summary.ColData;
  return { debit: Number(cells[1].value), credit: Number(cells[2].value) };
};

test("official sample: flat rows with no type field are parsed and the GrandTotal row is skipped", () => {
  const sections = parseTrialBalanceReport(OFFICIAL_TRIAL_BALANCE);

  assert.equal(sections.length, 1);
  assert.equal(sections[0].title, "Accounts");
  assert.deepEqual(
    sections[0].rows.map((r) => [r.accountId, r.name, r.debit, r.credit]),
    [
      ["35", "Checking", 4151.74, 0],
      ["13", "Meals and Entertainment", 0, 46],
      ["93", "QuickBooks Payments Fees", 0.44, 0],
    ]
  );
});

test("official sample: the report date comes from Header.EndPeriod", () => {
  assert.equal(getQuickbooksReportDate(OFFICIAL_TRIAL_BALANCE), "2016-03-14");
});

test("official sample: Account entities map to dimension data; a missing AcctNum falls back to Id", () => {
  const dimension = mapQuickbooksAccountDimension(OFFICIAL_ACCOUNTS[0]);

  assert.deepEqual(dimension, {
    id: "92",
    code: "92",
    name: "Canadian Accounts Receivable",
    type: "Accounts Receivable",
    classification: "Asset",
    taxCode: undefined, // US sample: TaxCodeRef is only on AU/GB/CA accounts
  });
});

test("official sample: TaxCode ids are per company and can be non-numeric", () => {
  const names = new Map(OFFICIAL_TAX_CODES.map((t) => [String(t.Id), t.Name]));

  // Id 2 is "California" in Intuit's sample company, so a hardcoded 2 -> GST would mislabel it.
  assert.equal(mapQuickbooksTaxCode({ value: "2" }, names), "UNMAPPED:California");
  assert.equal(mapQuickbooksTaxCode({ value: "TAX" }, names), "UNMAPPED:TAX");
});

test("AU company: rows add up to the report's own GrandTotal", () => {
  const rows = parseTrialBalanceReport(AU_TRIAL_BALANCE).flatMap((s) => s.rows);
  const total = grandTotal(AU_TRIAL_BALANCE);

  assert.equal(round2(rows.reduce((sum, r) => sum + r.debit, 0)), total.debit); // 64010.00
  assert.equal(round2(rows.reduce((sum, r) => sum + r.credit, 0)), total.credit); // 64010.00
});

test("AU company: canonical rows balance, with one header that nets to zero", () => {
  const accounts = buildQuickbooksAccounts(AU_ACCOUNTS, AU_TRIAL_BALANCE, AU_TAX_CODES);
  const [header, ...details] = accounts;

  assert.equal(accounts.filter((a) => a.isHeader).length, 1);
  assert.equal(header.name, "Accounts");
  assert.equal(header.value, 0);
  assert.equal(header.drCr, undefined);

  // 12 accounts on the trial balance + the one not in the Account list; Travel (73) has no balance row.
  assert.equal(details.length, 13);
  assert.equal(details.some((a) => a.id === "73"), false);

  const side = (s) => round2(details.filter((a) => a.drCr === s).reduce((sum, a) => sum + a.value, 0));
  assert.equal(side("Dr"), 64130); // 64010 debits + the 120 negative credit-card credit
  assert.equal(side("Cr"), 64130);
});

test("AU company: each detail row gets its code, side, value and client tax code", () => {
  const byId = new Map(buildQuickbooksAccounts(AU_ACCOUNTS, AU_TRIAL_BALANCE, AU_TAX_CODES).map((a) => [a.id, a]));
  const row = (id) => {
    const a = byId.get(id);
    return [a.code, a.name, a.type, a.drCr, a.value, a.taxCode];
  };

  assert.deepEqual(row("35"), ["1-1110", "Business Cheque", "Bank", "Dr", 18450, "N-T"]); // Out of Scope
  assert.deepEqual(row("37"), ["1-2100", "Office Equipment", "Fixed Asset", "Dr", 4200, "GCA"]); // GST on capital
  assert.deepEqual(row("38"), ["2-1100", "Business Credit Card", "Credit Card", "Dr", 120, "N-T"]); // -120.00 credit
  assert.deepEqual(row("41"), ["2-1300", "GST Liability", "Other Current Liability", "Cr", 1240, undefined]); // no TaxCodeRef
  assert.deepEqual(row("60"), ["4-1000", "Sales", "Income", "Cr", 42000, "GST"]);
  assert.deepEqual(row("61"), ["4-1100", "Export Sales", "Income", "Cr", 3500, "FRE"]); // GST free export
  assert.deepEqual(row("70"), ["5-1000", "Cost of Sales", "Cost of Goods Sold", "Dr", 21000, "GST"]); // GST on non-capital
  assert.deepEqual(row("71"), ["6-1000", "Bank Fees", "Expense", "Dr", 339.5, "UNMAPPED:Input tax"]);
  assert.deepEqual(row("72"), ["6-2000", "Rent", "Expense", "Dr", 13200, "FRE"]); // GST-free non-capital
});

test("AU company: a trial balance row missing from the Account list keeps the report's name", () => {
  const accounts = buildQuickbooksAccounts(AU_ACCOUNTS, AU_TRIAL_BALANCE, AU_TAX_CODES);
  const opening = accounts.find((a) => a.id === "99");

  assert.equal(opening.name, "Opening Balance Equity");
  assert.equal(opening.code, undefined);
  assert.equal(opening.value, 0);
  assert.equal(opening.drCr, undefined); // zero balance and no Classification to fall back on
  assert.equal(opening._vendorSpecific.matchedToAccountsList, false);
});

test("AU company: the report date is the company's period end, not the server's date", () => {
  assert.equal(getQuickbooksReportDate(AU_TRIAL_BALANCE), "2026-06-30");
});
