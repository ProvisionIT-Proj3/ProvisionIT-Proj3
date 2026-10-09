const { getAccounts: getRawAccounts } = require("./accounts");
const { getTrialBalance } = require("./trialBalance");
const { buildXeroAccounts } = require("../../mappers/xero/accountMapper");

// Canonical accounts can't come from a single Xero call: dimension data
// (Code, Name, Type, Class, TaxType) comes from GET /Accounts, balances
// and section hierarchy come from GET /Reports/TrialBalance. Fetch both
// raw responses and let buildXeroAccounts() combine + map them so this
// connector's getAccounts() matches the canonical ACCOUNT_SCHEMA like
// every other connector behind connectorFactory.
async function getAccounts(connectionId) {
  const [rawAccounts, trialBalanceReport] = await Promise.all([
    getRawAccounts(connectionId),
    getTrialBalance(connectionId),
  ]);

  // getTrialBalance() already unwraps Reports/TrialBalance down to the
  // single report object; buildXeroAccounts expects the raw
  // { Reports: [...] } envelope, so put it back.
  return buildXeroAccounts(rawAccounts, {
    Reports: trialBalanceReport ? [trialBalanceReport] : [],
  });
}

module.exports = {
  getAccounts,
  getTrialBalance,
};
