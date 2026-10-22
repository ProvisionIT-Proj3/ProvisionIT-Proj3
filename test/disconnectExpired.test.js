const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/core/stateStore");
const TestMemoryConnectionStore = require("../src/auth/core/testMemoryConnectionStore");
const OAuthService = require("../src/auth/core/oauthService");
const TokenCipher = require("../src/auth/core/tokenCipher");
const XeroProvider = require("../src/auth/providers/xero/provider");

const provider = new XeroProvider({
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/auth/xero/callback",
  scopes: ["offline_access"],
  authorizationUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  connectionsUrl: "https://api.xero.com/connections",
  apiBaseUrl: "https://api.xero.com/api.xro/2.0/",
});

function createStore() {
  return new TestMemoryConnectionStore({
    provider: "xero",
    tokenCipher: new TokenCipher({ key: Buffer.alloc(32, 7), keyVersion: "test" }),
  });
}

async function saveExpired(store) {
  await store.save({
    connectionId: "connection-1",
    provider: "xero",
    externalConnectionId: "connection-1",
    providerAccountId: "tenant-1",
    oauthGrantId: "grant-1",
    accessToken: "expired-access",
    refreshToken: "expired-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  await store.markReauthorizationRequired("connection-1");
}

test("removes a connection that needs reauthorization without calling Xero", async () => {
  const store = createStore();
  await saveExpired(store);
  let providerCalls = 0;
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async () => {
      providerCalls += 1;
      return new Response(null, { status: 204 });
    },
  });

  await service.disconnect("connection-1");
  assert.equal(providerCalls, 0);
  assert.equal(await store.getByConnectionId("connection-1"), null);
});

test("still reports an unknown connection as not found", async () => {
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: createStore(),
  });

  await assert.rejects(service.disconnect("missing"), { code: "XERO_CONNECTION_NOT_FOUND", status: 404 });
});
