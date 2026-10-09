const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { buildQuickbooksAccounts } = require("../../mappers/quickbooks/accountMapper");

// Mirrors the Xero connector: dimension data (Name, AccountType,
// Classification, TaxCodeRef) comes from the Account query, balances and
// section hierarchy from the TrialBalance report. buildQuickbooksAccounts()
// combines + maps them so this connector's getAccounts() matches the
// canonical ACCOUNT_SCHEMA like every other connector behind connectorFactory.
async function getAccounts(connectionId) {
  const [rawAccounts, trialBalanceReport] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId),
  ]);

  return buildQuickbooksAccounts(rawAccounts, trialBalanceReport);
}

module.exports = {
  getAccounts,
  getTrialBalance,
};
