const { quickBooksRequest } = require("./quickBooksClient");

// QuickBooks limits account queries to 1000 records per response.
// Retrieving additional pages prevents larger Charts of Accounts
// from being returned with missing records.
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

    // Invalid responses must not be mistaken for empty account lists.
    // Otherwise missing financial data could go unnoticed.
    if (!data?.QueryResponse) {
      throw new Error("Invalid QuickBooks Accounts response.");
    }

    const page = data.QueryResponse.Account ?? [];

    if (!Array.isArray(page)) {
      throw new Error("Invalid QuickBooks Accounts data.");
    }

    accounts.push(...page);

    // A shorter page means there are no further records to retrieve.
    if (page.length < PAGE_SIZE) {
      break;
    }

    startPosition += PAGE_SIZE;
  }

  return accounts;
}

module.exports = { getAccounts };
