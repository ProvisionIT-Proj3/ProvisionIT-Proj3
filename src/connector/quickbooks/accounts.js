const { quickBooksRequest } = require("./quickBooksClient");

async function getAccounts(connectionId) {
  const query = encodeURIComponent("select * from Account");

  const data = await quickBooksRequest(
    connectionId,
    `query?query=${query}`
  );

  return data.QueryResponse?.Account ?? [];
}

module.exports = { getAccounts };
