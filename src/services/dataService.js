const { getAccounts: getXeroAccounts } = require(
  "../connector/xero/accounts"
);

const { getTrialBalance: getXeroTrialBalance } = require(
  "../connector/xero/trialBalance"
);

async function getAccounts(connectionId) {
  const accounts = await getXeroAccounts(connectionId);

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
