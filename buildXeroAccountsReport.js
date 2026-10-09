/**
 * Builds the client's requested Account report shape from Xero's
 * GET /Accounts + GET /Reports/TrialBalance, and writes both a JSON and a
 * CSV file matching the exact column layout the client asked for:
 *
 *   Account #, Account, Type, Dr/Cr, Header/Detail, Level, Value, Tax Code
 */
const fs = require('fs');
const path = require('path');
const { buildXeroAccounts } = require('./src/mappers/xero/accountMapper');
const { validate } = require('./src/canonical/schemas');

const accountsFile = process.argv[2] || path.join(__dirname, 'sample_data', 'xero', 'accounts.json');
const trialBalanceFile = process.argv[3] || path.join(__dirname, 'sample_data', 'xero', 'trial_balance.json');
const outputBase = process.argv[4] || path.join(__dirname, 'output', 'xero_accounts_report');

const rawAccounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
const rawTrialBalance = JSON.parse(fs.readFileSync(trialBalanceFile, 'utf8'));

const accounts = buildXeroAccounts(rawAccounts, rawTrialBalance);

// Validate every row and surface anything that doesn't meet the schema.
const invalid = [];
for (const account of accounts) {
  const { valid, errors } = validate('account', account);
  if (!valid) invalid.push({ id: account.id, errors });
}

fs.mkdirSync(path.dirname(outputBase), { recursive: true });

// --- JSON output (full canonical detail, including _vendorSpecific) ---
fs.writeFileSync(`${outputBase}.json`, JSON.stringify(accounts, null, 2));

// --- CSV output, matching the client's exact requested column layout ---
const csvHeader = 'Account #,Account,Type,Dr/Cr,Header/Detail,Level,Value,Tax Code';
const csvRows = accounts.map((a) => {
  const escape = (v) => (v === undefined || v === null ? '' : String(v).includes(',') ? `"${v}"` : v);
  return [
    escape(a.code),
    escape(a.name),
    escape(a.type),
    escape(a.drCr),
    a.isHeader ? 'Header' : 'Detail',
    a.level,
    a.value === undefined ? '' : a.value.toFixed(2),
    escape(a.taxCode),
  ].join(',');
});
fs.writeFileSync(`${outputBase}.csv`, [csvHeader, ...csvRows].join('\n'));

console.log(`Wrote ${accounts.length} account rows to:`);
console.log(`  ${outputBase}.json`);
console.log(`  ${outputBase}.csv`);
if (invalid.length) {
  console.log(`\n${invalid.length} row(s) failed validation:`);
  console.log(JSON.stringify(invalid, null, 2));
} else {
  console.log('\nAll rows passed validation.');
}
