// Generates a self-consistent AU QuickBooks fixture set in Intuit's published
// response shapes. Usage: node test/fixtures/quickbooks/au_company/generate.js test/fixtures/quickbooks/au_company
const fs = require("fs");
const path = require("path");

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

const meta = { CreateTime: "2025-07-01T09:00:00+10:00", LastUpdatedTime: "2026-06-30T17:00:00+10:00" };

// [Id, AcctNum, Name, Classification, AccountType, AccountSubType, TaxCode Id | null, TB debit, TB credit]
const ACCOUNTS = [
  ["35", "1-1110", "Business Cheque", "Asset", "Bank", "Checking", "11", "18450.00", ""],
  ["36", "1-1200", "Accounts Receivable", "Asset", "Accounts Receivable", "AccountsReceivable", "11", "6820.50", ""],
  ["37", "1-2100", "Office Equipment", "Asset", "Fixed Asset", "MachineryAndEquipment", "7", "4200.00", ""],
  ["38", "2-1100", "Business Credit Card", "Liability", "Credit Card", "CreditCard", "11", "", "-120.00"],
  ["40", "2-1200", "Accounts Payable", "Liability", "Accounts Payable", "AccountsPayable", "11", "", "3150.00"],
  ["41", "2-1300", "GST Liability", "Liability", "Other Current Liability", "GlobalTaxPayable", null, "", "1240.00"],
  ["50", "3-1000", "Owner's Equity", "Equity", "Equity", "OwnersEquity", null, "", "14240.00"],
  ["60", "4-1000", "Sales", "Revenue", "Income", "SalesOfProductIncome", "3", "", "42000.00"],
  ["61", "4-1100", "Export Sales", "Revenue", "Income", "SalesOfProductIncome", "5", "", "3500.00"],
  ["70", "5-1000", "Cost of Sales", "Expense", "Cost of Goods Sold", "SuppliesMaterialsCogs", "8", "21000.00", ""],
  ["71", "6-1000", "Bank Fees", "Expense", "Expense", "BankCharges", "10", "339.50", ""],
  ["72", "6-2000", "Rent", "Expense", "Expense", "RentOrLeaseOfBuildings", "9", "13200.00", ""],
  // In the Account list but not on the trial balance (QBO leaves zero-balance accounts off).
  ["73", "6-3000", "Travel", "Expense", "Expense", "Travel", "8", null, null],
];
// On the trial balance but missing from the Account list (e.g. a page of accounts not fetched).
const UNMATCHED_TB_ROW = ["99", "Opening Balance Equity", "", "0.00"];

const Account = ACCOUNTS.map(([Id, AcctNum, Name, Classification, AccountType, AccountSubType, tax]) => ({
  Name,
  SubAccount: false,
  FullyQualifiedName: Name,
  Active: true,
  Classification,
  AccountType,
  AccountSubType,
  AcctNum,
  CurrentBalance: 0,
  CurrentBalanceWithSubAccounts: 0,
  CurrencyRef: { value: "AUD", name: "Australian Dollar" },
  ...(tax ? { TaxCodeRef: { value: tax } } : {}),
  domain: "QBO",
  sparse: false,
  Id,
  SyncToken: "0",
  MetaData: meta,
}));

const tbRows = ACCOUNTS.filter((a) => a[7] !== null)
  .map((a) => [a[0], a[2], a[7], a[8]])
  .concat([UNMATCHED_TB_ROW]);
const total = (i) => tbRows.reduce((s, r) => s + (r[i] === "" ? 0 : Number(r[i])), 0).toFixed(2);

const trialBalance = {
  Header: {
    Time: "2026-06-30T17:05:00+10:00",
    ReportName: "TrialBalance",
    DateMacro: "this fiscal year-to-date",
    ReportBasis: "Accrual",
    StartPeriod: "2025-07-01",
    EndPeriod: "2026-06-30",
    Currency: "AUD",
    Option: [{ Name: "NoReportData", Value: "false" }],
  },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Account" },
      { ColTitle: "Debit", ColType: "Money" },
      { ColTitle: "Credit", ColType: "Money" },
    ],
  },
  Rows: {
    Row: [
      ...tbRows.map(([id, name, dr, cr]) => ({ ColData: [{ value: name, id }, { value: dr }, { value: cr }] })),
      {
        Summary: { ColData: [{ value: "TOTAL" }, { value: total(2) }, { value: total(3) }] },
        type: "Section",
        group: "GrandTotal",
      },
    ],
  },
};

const TAX = [
  ["2", "GST free"],
  ["3", "GST"],
  ["5", "GST free export"],
  ["7", "GST on capital"],
  ["8", "GST on non-capital"],
  ["9", "GST-free non-capital"],
  ["10", "Input tax"],
  ["11", "Out of Scope"],
];
const TaxCode = TAX.map(([Id, Name]) => ({
  Name,
  Description: Name,
  Active: true,
  Taxable: Name === "GST" || Name.startsWith("GST on"),
  TaxGroup: false,
  domain: "QBO",
  sparse: false,
  Id,
  SyncToken: "0",
  MetaData: meta,
}));

const write = (file, obj) => fs.writeFileSync(path.join(out, file), JSON.stringify(obj, null, 2) + "\n");
write("account_query.json", {
  QueryResponse: { Account, startPosition: 1, maxResults: Account.length },
  time: "2026-06-30T17:05:00.000+10:00",
});
write("trial_balance.json", trialBalance);
write("taxcode_query.json", {
  QueryResponse: { TaxCode, startPosition: 1, maxResults: TaxCode.length, totalCount: TaxCode.length },
  time: "2026-06-30T17:05:00.000+10:00",
});

console.log("GrandTotal", total(2), total(3));
