const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/core/stateStore");
const TestMemoryConnectionStore = require("../src/auth/core/testMemoryConnectionStore");
const OAuthService = require("../src/auth/core/oauthService");
const TokenCipher = require("../src/auth/core/tokenCipher");
const XeroProvider = require("../src/auth/providers/xero/provider");
const QuickBooksProvider = require("../src/auth/providers/quickbooks/provider");
const { getQuickBooksConfig } = require("../src/auth/providers/quickbooks/config");

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

function createStore(providerId = "xero") {
  return new TestMemoryConnectionStore({
    provider: providerId,
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

const quickBooksProvider = new QuickBooksProvider(getQuickBooksConfig({
  QUICKBOOKS_CLIENT_ID: "client-id",
  QUICKBOOKS_CLIENT_SECRET: "client-secret",
}));

for (const testProvider of [provider, quickBooksProvider]) {
  async function setup({ refreshToken = "fixture-refresh", expired = true, fetchImpl }) {
    const store = createStore(testProvider.id);
    await store.save({
      connectionId: "connection-1",
      provider: testProvider.id,
      externalConnectionId: "external-1",
      providerAccountId: "company-1",
      oauthGrantId: "grant-1",
      accessToken: "fixture-access",
      refreshToken,
      expiresAt: new Date(Date.now() + (expired ? -1000 : 3600000)).toISOString(),
      status: "active",
    });
    const events = [];
    const service = new OAuthService({
      provider: testProvider,
      connectionStore: store,
      stateStore: new OAuthStateStore(),
      fetchImpl,
      auditLogger: { record: async event => events.push(event) },
    });
    return { store, service, events };
  }

  test(`${testProvider.id}: removes an expired active connection with no refresh token`, async () => {
    let providerCalls = 0;
    const { store, service, events } = await setup({
      refreshToken: null,
      fetchImpl: async () => { providerCalls += 1; throw new Error("Unexpected provider call"); },
    });

    await service.disconnect("connection-1", { actorUserId: "admin-1" });

    assert.equal(providerCalls, 0);
    assert.equal(await store.getByConnectionId("connection-1"), null);
    assert.ok(events.some(event => event.action === "connection.disconnected"
      && event.outcome === "success" && event.actorUserId === "admin-1"));
  });

  test(`${testProvider.id}: removes a connection on the first attempt when refresh is revoked`, async () => {
    let providerCalls = 0;
    const { store, service } = await setup({
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      },
    });

    await service.disconnect("connection-1");

    assert.equal(providerCalls, 1);
    assert.equal(await store.getByConnectionId("connection-1"), null);
  });

  test(`${testProvider.id}: retains the connection after a temporary refresh failure`, async () => {
    const { store, service, events } = await setup({
      fetchImpl: async () => new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 503 }),
    });

    await assert.rejects(service.disconnect("connection-1"), { status: 502 });

    assert.equal((await store.getByConnectionId("connection-1")).status, "active");
    assert.ok(events.some(event => event.action === "connection.disconnected" && event.outcome === "failure"));
  });

  test(`${testProvider.id}: retains the connection when provider disconnection fails`, async () => {
    const { store, service } = await setup({
      expired: false,
      fetchImpl: async () => new Response(null, { status: 503 }),
    });

    await assert.rejects(service.disconnect("connection-1"), { status: 502 });

    assert.notEqual(await store.getByConnectionId("connection-1"), null);
  });
}
