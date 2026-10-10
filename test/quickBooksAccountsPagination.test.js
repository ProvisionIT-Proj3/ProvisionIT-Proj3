const test = require("node:test");
const assert = require("node:assert/strict");
const client = require("../src/connector/quickbooks/quickBooksClient");

test("QuickBooks retrieves all pages of Accounts", async (t) => {
  const firstPage = Array.from({ length: 1000 }, (_, i) => ({
    Id: String(i + 1),
  }));

  const secondPage = [
    { Id: "1001" },
    { Id: "1002" },
  ];

  const requests = [];

  t.mock.method(client, "quickBooksRequest", async (connectionId, path) => {
    assert.equal(connectionId, "test-connection");
    requests.push(decodeURIComponent(path));

    if (requests.length === 1) {
      return { QueryResponse: { Account: firstPage } };
    }

    if (requests.length === 2) {
      return { QueryResponse: { Account: secondPage } };
    }

    throw new Error("Unexpected extra API request");
  });

  const modulePath = require.resolve(
    "../src/connector/quickbooks/accounts"
  );

  delete require.cache[modulePath];
  t.after(() => delete require.cache[modulePath]);

  const { getAccounts } = require(modulePath);

  const accounts = await getAccounts("test-connection");

  assert.equal(accounts.length, 1002);
  assert.equal(accounts[0].Id, "1");
  assert.equal(accounts[1001].Id, "1002");

  assert.equal(requests.length, 2);
  assert.match(requests[0], /STARTPOSITION 1 MAXRESULTS 1000/);
  assert.match(requests[1], /STARTPOSITION 1001 MAXRESULTS 1000/);
});
