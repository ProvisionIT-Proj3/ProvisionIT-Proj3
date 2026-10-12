const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { buildXeroAccounts, getXeroReportDate } = require("../../mappers/xero/accountMapper");

// Canonical accounts can't come from a single Xero call: dimension data
// (Code, Name, Type, Class, TaxType) comes from GET /Accounts, balances
// and section hierarchy come from GET /Reports/TrialBalance. Fetch both
// raw responses and let buildXeroAccounts() combine + map them so this
// connector's accounts match the canonical ACCOUNT_SCHEMA like every
// other connector behind connectorFactory.
//
// options: { endDate } for the TrialBalance report.
async function getAccountsReport(connectionId, options = {}) {
  const [rawAccounts, trialBalanceReport] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId, options),
  ]);

  // getTrialBalance() already unwraps Reports/TrialBalance down to the
  // single report object; the mapper expects the raw { Reports: [...] }
  // envelope, so put it back.
  const rawReport = { Reports: trialBalanceReport ? [trialBalanceReport] : [] };

  return {
    accounts: buildXeroAccounts(rawAccounts, rawReport),
    reportDate: getXeroReportDate(rawReport),
  };
}

async function getAccounts(connectionId, options = {}) {
  const { accounts } = await getAccountsReport(connectionId, options);
  return accounts;
}

module.exports = {
  getAccounts,
  getAccountsReport,
  getTrialBalance,
};
