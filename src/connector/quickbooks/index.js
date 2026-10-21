const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { getTaxCodes } = require("./taxCodes");
const {
  buildQuickbooksAccounts,
  getQuickbooksReportDate,
} = require("../../mappers/quickbooks/accountMapper");

// The Accounts API provides account details, while the Trial Balance
// provides balances for the requested reporting period.
// Tax codes are retrieved separately to support consistent mapping.
// These requests can run together because they do not depend on each other.
async function getAccountsReport(connectionId, options = {}) {
  const [rawAccounts, trialBalanceReport, rawTaxCodes] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId, options),
    getTaxCodes(connectionId),
  ]);

  // Preserve the report date so consumers can identify the period
  // associated with the mapped account balances.
  return {
    accounts: buildQuickbooksAccounts(rawAccounts, trialBalanceReport, rawTaxCodes),
    reportDate: getQuickbooksReportDate(trialBalanceReport),
  };
}

// Some callers only need the canonical accounts without report metadata.
async function getAccounts(connectionId, options = {}) {
  const { accounts } = await getAccountsReport(connectionId, options);
  return accounts;
}

module.exports = {
  getAccounts,
  getAccountsReport,
  getTrialBalance,
};
