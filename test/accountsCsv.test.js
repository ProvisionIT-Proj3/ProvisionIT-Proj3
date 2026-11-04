const test = require("node:test");
const assert = require("node:assert/strict");

const { accountsToCsv } = require("../src/export/accountsCsv");
const { buildXeroAccounts } = require("../src/mappers/xero/accountMapper");

const HEADER = "Account #,Account,Type,Dr/Cr,Header/Detail,Level,Balance,Tax Code";
const rowsOf = (csv) => csv.trimEnd().split("\r\n");

const header = (over) => ({ id: "h", isHeader: true, level: 1, name: "Assets", type: "Asset", code: "1-0000", drCr: "Dr", value: 0, ...over });
const detail = (over) => ({ id: "d", isHeader: false, level: 2, name: "Bank", type: "Bank", code: "1-1110", drCr: "Dr", value: 0, taxCode: "N-T", ...over });

test("an empty list is just the column row", () => {
  assert.equal(accountsToCsv([]), `${HEADER}\r\n`);
});

test("rows use Debit/Credit, Header/Detail, two-decimal balances and pass the account number through", () => {
  const csv = accountsToCsv([header({ value: 100.5 }), detail({ value: 100.5 })]);

  assert.deepEqual(rowsOf(csv), [
    HEADER,
    "1-0000,Assets,Asset,Debit,Header,1,100.50,",
    "1-1110,Bank,Bank,Debit,Detail,2,100.50,N-T",
  ]);
});

test("a balance on the opposite side to its group is negative, as in the MYOB export", () => {
  const csv = accountsToCsv([
    header({ value: 60 }),
    detail({ name: "Overdrawn", drCr: "Cr", value: 40 }), // asset with a credit balance
    detail({ name: "Cash", value: 100 }),
    header({ name: "Liabilities", type: "Liability", code: "2-0000", drCr: "Cr", value: 25 }),
    detail({ name: "Card", code: "2-1100", drCr: "Dr", value: 5 }), // liability with a debit balance
    detail({ name: "Loan", code: "2-1200", drCr: "Cr", value: 30 }),
  ]);

  assert.deepEqual(
    rowsOf(csv).slice(1).map((l) => l.split(",").slice(1, 7).join(",")),
    [
      "Assets,Asset,Debit,Header,1,60.00",
      "Overdrawn,Bank,Debit,Detail,2,-40.00",
      "Cash,Bank,Debit,Detail,2,100.00",
      "Liabilities,Liability,Credit,Header,1,25.00",
      "Card,Bank,Credit,Detail,2,-5.00",
      "Loan,Bank,Credit,Detail,2,30.00",
    ]
  );
});

test("rows outside a known group keep their own side and sign", () => {
  const csv = accountsToCsv([
    header({ code: "UNCLASSIFIED", name: "Unclassified", type: "Unclassified", drCr: "Cr", value: 10 }),
    detail({ code: undefined, name: "Mystery", type: undefined, taxCode: undefined, drCr: "Cr", value: 10 }),
  ]);

  assert.deepEqual(rowsOf(csv).slice(1), [
    "UNCLASSIFIED,Unclassified,Unclassified,Credit,Header,1,10.00,",
    ",Mystery,,Credit,Detail,2,10.00,",
  ]);
});

test("a zero-value row with no side leaves Dr/Cr to its group", () => {
  const csv = accountsToCsv([header(), detail({ drCr: undefined, value: 0 })]);
  assert.equal(rowsOf(csv)[2], "1-1110,Bank,Bank,Debit,Detail,2,0.00,N-T");
});

test("commas, quotes and line breaks in a name are quoted", () => {
  const csv = accountsToCsv([header(), detail({ name: 'Smith, "J" & Co\nPty' })]);
  assert.ok(csv.includes('"Smith, ""J"" & Co\nPty"'));
});

test("text that a spreadsheet would run as a formula is defused", () => {
  const csv = accountsToCsv([header(), detail({ name: "=HYPERLINK(\"http://x\")", type: "+cmd", code: "-1", taxCode: "@x" })]);
  const line = rowsOf(csv)[2];

  assert.ok(line.startsWith("'-1,\"'=HYPERLINK("));
  assert.ok(line.includes(",'+cmd,"));
  assert.ok(line.endsWith(",'@x"));
  // A negative balance is a number, not text, so it stays unquoted.
  assert.ok(accountsToCsv([header(), detail({ drCr: "Cr", value: 5 })]).includes(",-5.00,"));
});

test("the preamble adds company, title and an as-of date in dd/mm/yyyy", () => {
  const csv = accountsToCsv([], { preamble: true, companyName: "PVIT, Demo", reportDate: "2026-06-30" });
  assert.deepEqual(rowsOf(csv), ['"PVIT, Demo"', "Accounts List [Detail]", "As of 30/06/2026", HEADER]);

  assert.deepEqual(rowsOf(accountsToCsv([], { preamble: true })), ["Accounts List [Detail]", HEADER]);
  assert.deepEqual(rowsOf(accountsToCsv([], { companyName: "X", reportDate: "2026-06-30" })), [HEADER]); // opt-in only
});

test("Xero sample end to end: balances match the mapper's rows and the group totals agree", () => {
  const accounts = buildXeroAccounts(
    require("./fixtures/xero/accounts.json").Accounts,
    require("./fixtures/xero/trial_balance.official.json")
  );
  const lines = rowsOf(accountsToCsv(accounts));

  assert.equal(lines.length, accounts.length + 1);
  assert.ok(lines.includes("1-0000,Assets,Asset,Debit,Header,1,45601.51,"));
  assert.ok(lines.includes("1400,Generic Inventory,INVENTORY,Debit,Detail,3,-160.00,N-T")); // credit balance on an asset
  assert.ok(lines.includes("250,Suspense,CURRLIAB,Credit,Detail,3,-41.00,N-T")); // debit balance on a liability
  assert.ok(lines.includes("400,Sales,REVENUE,Credit,Detail,2,1020.22,GST"));
});
