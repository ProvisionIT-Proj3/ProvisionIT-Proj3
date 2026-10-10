const test = require("node:test");
const assert = require("node:assert/strict");

const { registry } = require("../src/auth");
const { quickBooksRequest } = require(
  "../src/connector/quickbooks/quickBooksClient"
);

test("QuickBooks client handles failed API requests", async (t) => {
  t.mock.method(registry, "require", (provider) => {
    assert.equal(provider, "quickbooks");

    return {
      request: async () => ({
        ok: false,
        status: 429,
      }),
    };
  });

  await assert.rejects(
    quickBooksRequest("test-connection", "query?query=test"),
    (error) => {
      assert.equal(error.code, "QUICKBOOKS_API_ERROR");
      assert.equal(error.status, 429);
      return true;
    }
  );
});
