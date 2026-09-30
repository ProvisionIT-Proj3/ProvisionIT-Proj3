const { getAccounts: getXeroAccounts } = require(
  "../connector/xero/accounts"
);

const { getTrialBalance: getXeroTrialBalance } = require(
  "../connector/xero/trialBalance"
);

const { buildXeroAccounts } = require("../mappers/xero/accountMapper");

async function getAccounts(connectionId) {
  // Canonical accounts can't come from a single Xero call: dimension data
  // (Code, Name, Type, Class, TaxType) comes from GET /Accounts, balances
  // and section hierarchy come from GET /Reports/TrialBalance. Fetch both
  // raw responses and let buildXeroAccounts() combine + map them.
  const [rawAccounts, trialBalanceReport] = await Promise.all([
    getXeroAccounts(connectionId),
    getXeroTrialBalance(connectionId),
  ]);

  // The connector already unwraps Reports/TrialBalance down to the single
  // report object; buildXeroAccounts expects the raw { Reports: [...] }
  // envelope, so put it back.
  const accounts = buildXeroAccounts(rawAccounts, {
    Reports: trialBalanceReport ? [trialBalanceReport] : [],
  });

  return {
    data: accounts,
    pagination: {
      page: 1,
      pageSize: accounts.length,
      totalItems: accounts.length,
    },
  };
}

async function getTrialBalance(connectionId) {
  const trialBalance = await getXeroTrialBalance(connectionId);

  return {
    data: trialBalance,
  };
}

module.exports = {
  getAccounts,
  getTrialBalance,
};
