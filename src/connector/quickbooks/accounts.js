const { quickBooksRequest } = require("./quickBooksClient");

const PAGE_SIZE = 1000;

async function getAccounts(connectionId) {
  const accounts = [];
  let startPosition = 1;

  while (true) {
    const query = encodeURIComponent(
      `select * from Account STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    );

    const data = await quickBooksRequest(
      connectionId,
      `query?query=${query}`
    );

    if (!data?.QueryResponse) {
      throw new Error("Invalid QuickBooks Accounts response.");
    }

    const page = data.QueryResponse.Account ?? [];

    if (!Array.isArray(page)) {
      throw new Error("Invalid QuickBooks Accounts data.");
    }

    accounts.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    startPosition += PAGE_SIZE;
  }

  return accounts;
}

module.exports = { getAccounts };
