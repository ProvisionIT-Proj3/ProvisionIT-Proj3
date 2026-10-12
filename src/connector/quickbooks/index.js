const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { getTaxCodes } = require("./taxCodes");
const {
  buildQuickbooksAccounts,
  getQuickbooksReportDate,
} = require("../../mappers/quickbooks/accountMapper");

// Mirrors the Xero connector: dimension data (Name, AccountType,
// Classification, TaxCodeRef) comes from the Account query, balances and
// section hierarchy from the TrialBalance report, tax code names from the
// TaxCode query. buildQuickbooksAccounts() combines + maps them so this
// connector's accounts match the canonical ACCOUNT_SCHEMA like every other
// connector behind connectorFactory.
//
// options: { startDate, endDate, accountingMethod } for the TrialBalance report.
async function getAccountsReport(connectionId, options = {}) {
  const [rawAccounts, trialBalanceReport, rawTaxCodes] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId, options),
    getTaxCodes(connectionId),
  ]);

  return {
    accounts: buildQuickbooksAccounts(rawAccounts, trialBalanceReport, rawTaxCodes),
    reportDate: getQuickbooksReportDate(trialBalanceReport),
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
