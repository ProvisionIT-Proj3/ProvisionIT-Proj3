const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/core/stateStore");
const TestMemoryConnectionStore = require("../src/auth/core/testMemoryConnectionStore");
const OAuthService = require("../src/auth/core/oauthService");
const TokenCipher = require("../src/auth/core/tokenCipher");
const QuickBooksProvider = require("../src/auth/providers/quickbooks/provider");

function createConnectionStore() {
  return new TestMemoryConnectionStore({
    provider: "quickbooks",
    tokenCipher: new TokenCipher({ key: Buffer.alloc(32, 8), keyVersion: "test" }),
  });
}

const config = {
  clientId: "quickbooks-client-id",
  clientSecret: "quickbooks-client-secret",
  redirectUri: "http://localhost:3000/auth/quickbooks/callback",
  environment: "sandbox",
  scopes: ["com.intuit.quickbooks.accounting"],
  authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
  apiBaseUrl: "https://sandbox-quickbooks.api.intuit.com/v3/company/",
};

const provider = new QuickBooksProvider(config);

function connection(overrides = {}) {
  return {
    connectionId: "internal-connection-1",
    provider: "quickbooks",
    externalConnectionId: null,
    providerAccountId: "9341452901234567",
    oauthGrantId: "grant-1",
    accountName: "Demo QBO Company",
    metadata: { environment: "sandbox" },
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: "active",
    ...overrides,
  };
}

test("creates a QuickBooks authorization URL with accounting scope and state", () => {
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: createConnectionStore(),
  });

  const url = new URL(service.getAuthorizationUrl());
  assert.equal(url.origin + url.pathname, config.authorizationUrl);
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.ok(url.searchParams.get("state").length >= 40);
});

test("exchanges the callback code and stores the QuickBooks realm", async () => {
  const stateStore = new OAuthStateStore();
  const calls = [];
  const ids = ["internal-connection-1"];
  const store = createConnectionStore();
  const service = new OAuthService({
    provider,
    stateStore,
    connectionStore: store,
    idFactory: () => ids.shift(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === config.tokenUrl) {
        return new Response(JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ CompanyInfo: { CompanyName: "Demo QBO Company" } }), { status: 200 });
    },
  });
  const state = new URL(service.getAuthorizationUrl()).searchParams.get("state");

  const connections = await service.completeAuthorization({
    code: "authorization-code",
    state,
    realmId: "9341452901234567",
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(
    calls[1].url,
    "https://sandbox-quickbooks.api.intuit.com/v3/company/9341452901234567/companyinfo/9341452901234567",
  );
  assert.equal(calls[1].options.headers.Accept, "application/json");
  assert.equal(calls[1].options.headers.Authorization, "Bearer access-token");
  assert.equal(connections[0].connectionId, "internal-connection-1");
  assert.equal(connections[0].providerAccountId, "9341452901234567");
  assert.equal(connections[0].credentialId, undefined);
  assert.ok((await store.getByConnectionId("internal-connection-1")).credentialId);
  assert.equal(connections[0].accountName, "Demo QBO Company");
  assert.doesNotMatch(JSON.stringify(connections), /access-token|refresh-token/);
});

test("refreshes QuickBooks tokens and uses the company realm in API URLs", async () => {
  const store = createConnectionStore();
  await store.save(connection({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
  const calls = [];
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === config.tokenUrl) {
        return new Response(JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    },
  });

  await service.request("internal-connection-1", "query?query=select%20*%20from%20Customer");

  assert.equal(calls[1].url, "https://sandbox-quickbooks.api.intuit.com/v3/company/9341452901234567/query?query=select%20*%20from%20Customer");
  assert.equal(calls[1].options.headers.Authorization, "Bearer new-access-token");
  assert.equal((await store.getByConnectionId("internal-connection-1")).refreshToken, "new-refresh-token");
});

test("revokes the QuickBooks refresh token before deleting the local connection", async () => {
  const store = createConnectionStore();
  await store.save(connection());
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async (url, options) => {
      assert.equal(url, config.revokeUrl);
      assert.match(options.headers.Authorization, /^Basic /);
      assert.deepEqual(JSON.parse(options.body), { token: "refresh-token" });
      return new Response(null, { status: 200 });
    },
  });

  await service.disconnect("internal-connection-1");
  assert.equal(await store.getByConnectionId("internal-connection-1"), null);
});

test("marks the QuickBooks grant for reauthorization after invalid_grant", async () => {
  const store = createConnectionStore();
  await store.save(connection({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });

  await assert.rejects(
    service.getAuthorizationHeaders("internal-connection-1"),
    { code: "QUICKBOOKS_REAUTHORIZATION_REQUIRED", status: 401 },
  );
  assert.equal((await store.getByConnectionId("internal-connection-1")).status, "reauthorization_required");
});

test("rejects absolute QuickBooks API URLs before sending credentials", async () => {
  const store = createConnectionStore();
  await store.save(connection());
  let fetchCalled = false;
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    service.request("internal-connection-1", "https://example.com/steal"),
    { code: "INVALID_QUICKBOOKS_API_PATH", status: 400 },
  );
  assert.equal(fetchCalled, false);
});

test("reports whether an internal connection belongs to QuickBooks", async () => {
  const store = createConnectionStore();
  await store.save(connection());
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
  });

  assert.equal(await service.hasConnection("internal-connection-1"), true);
  assert.equal(await service.hasConnection("missing"), false);
});
