const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { buildXeroAccounts, getXeroReportDate } = require("../../mappers/xero/accountMapper");

// Xero provides account details and financial balances through separate APIs.
// The Accounts response contains account information, while the Trial Balance
// provides balances and reporting sections.
// Both requests are independent, so they can run together before mapping.
//
// The endDate option determines the reporting date for the Trial Balance.
async function getAccountsReport(connectionId, options = {}) {
  const [rawAccounts, trialBalanceReport] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId, options),
  ]);

  // The Trial Balance client returns a single report object.
  // The canonical mapper expects the original Reports array structure,
  // so we restore that structure before passing the data to the mapper.
  const rawReport = { Reports: trialBalanceReport ? [trialBalanceReport] : [] };

  return {
    accounts: buildXeroAccounts(rawAccounts, rawReport),
    reportDate: getXeroReportDate(rawReport),
  };
}

// This method provides canonical accounts to callers that do not
// require the additional reporting date information.
async function getAccounts(connectionId, options = {}) {
  const { accounts } = await getAccountsReport(connectionId, options);
  return accounts;
}

module.exports = {
  getAccounts,
  getAccountsReport,
  getTrialBalance,
};
