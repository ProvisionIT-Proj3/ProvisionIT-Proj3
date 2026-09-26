const { getAccounts: getXeroAccounts } = require(
  "../connector/xero/accounts"
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

module.exports = {
  getAccounts,
};
