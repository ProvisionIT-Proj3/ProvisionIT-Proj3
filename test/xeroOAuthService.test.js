const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/xero/stateStore");
const TestMemoryXeroConnectionStore = require("../src/auth/xero/testMemoryConnectionStore");
const XeroOAuthService = require("../src/auth/xero/service");
const TokenCipher = require("../src/auth/xero/tokenCipher");

function createConnectionStore() {
  return new TestMemoryXeroConnectionStore({
    tokenCipher: new TokenCipher({ key: Buffer.alloc(32, 7), keyVersion: "test" }),
  });
}

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/auth/xero/callback",
  scopes: ["offline_access", "accounting.contacts.read"],
  authorizationUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  connectionsUrl: "https://api.xero.com/connections",
};

test("creates an Xero authorization URL with an opaque state", () => {
  const stateStore = new OAuthStateStore();
  const service = new XeroOAuthService({ config, stateStore, connectionStore: createConnectionStore() });

  const url = new URL(service.getAuthorizationUrl());
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("scope"), "offline_access accounting.contacts.read");
  assert.ok(url.searchParams.get("state").length >= 40);
});

test("exchanges a verified code and stores only connection metadata for reads", async () => {
  const stateStore = new OAuthStateStore();
  const calls = [];
  const service = new XeroOAuthService({
    config,
    stateStore,
    connectionStore: createConnectionStore(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === config.tokenUrl) {
        return new Response(JSON.stringify({ access_token: "secret-access", refresh_token: "secret-refresh", expires_in: 1800 }), { status: 200 });
      }
      return new Response(JSON.stringify([{ id: "connection-1", tenantId: "tenant-1", tenantName: "Demo Company", tenantType: "ORGANISATION" }]), { status: 200 });
    },
  });
  const state = new URL(service.getAuthorizationUrl()).searchParams.get("state");

  const connections = await service.completeAuthorization({ code: "one-time-code", state });

  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[1].options.headers.Authorization, "Bearer secret-access");
  assert.deepEqual(connections, [{ connectionId: "connection-1", tenantId: "tenant-1", tenantName: "Demo Company", tenantType: "ORGANISATION", createdAt: undefined, updatedAt: undefined, expiresAt: connections[0].expiresAt }]);
  assert.deepEqual(await service.listConnections(), connections);
});

test("refreshes an expiring token before returning connector headers", async () => {
  const store = createConnectionStore();
  await store.save({
    connectionId: "connection-1",
    tenantId: "tenant-1",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const calls = [];
  const service = new XeroOAuthService({
    config,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 1800 }), { status: 200 });
    },
  });

  const headers = await service.getAuthorizationHeaders("connection-1");

  assert.deepEqual(headers, { Authorization: "Bearer new-access", "xero-tenant-id": "tenant-1" });
  assert.equal(new URLSearchParams(calls[0].options.body).get("grant_type"), "refresh_token");
  assert.equal((await store.getByConnectionId("connection-1")).refreshToken, "new-refresh");
});

test("adds Xero credentials to connector requests without exposing them via the store list", async () => {
  const store = createConnectionStore();
  await store.save({
    connectionId: "connection-1",
    tenantId: "tenant-1",
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  const service = new XeroOAuthService({
    config,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.xero.com/api.xro/2.0/Contacts");
      assert.equal(options.headers.Authorization, "Bearer secret-access");
      assert.equal(options.headers["xero-tenant-id"], "tenant-1");
      return new Response("{}", { status: 200 });
    },
  });

  await service.request("connection-1", "https://api.xero.com/api.xro/2.0/Contacts");
  const stored = await store.getByConnectionId("connection-1");
  assert.deepEqual(await store.list(), [{ connectionId: "connection-1", tenantId: "tenant-1", expiresAt: stored.expiresAt }]);
});

test("disconnects the Xero connection and removes its local credential record", async () => {
  const store = createConnectionStore();
  await store.save({
    connectionId: "connection-1",
    tenantId: "tenant-1",
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  const service = new XeroOAuthService({
    config,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.xero.com/connections/connection-1");
      assert.equal(options.method, "DELETE");
      return new Response(null, { status: 204 });
    },
  });

  await service.disconnect("connection-1");
  assert.equal(await store.getByConnectionId("connection-1"), null);
});

test("rejects a callback whose state is unknown or has already been consumed", async () => {
  const service = new XeroOAuthService({ config, stateStore: new OAuthStateStore(), connectionStore: createConnectionStore() });
  await assert.rejects(
    service.completeAuthorization({ code: "code", state: "unknown" }),
    { code: "INVALID_OAUTH_STATE", status: 400 },
  );
});

test("marks a connection for reauthorization when Xero rejects its refresh token", async () => {
  const store = createConnectionStore();
  await store.save({
    connectionId: "connection-1",
    tenantId: "tenant-1",
    accessToken: "expired-access",
    refreshToken: "expired-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  let refreshCalls = 0;
  const service = new XeroOAuthService({
    config,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async () => {
      refreshCalls += 1;
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    },
  });

  await assert.rejects(
    service.getAuthorizationHeaders("connection-1"),
    { code: "XERO_REAUTHORIZATION_REQUIRED", status: 401 },
  );
  const connection = await store.getByConnectionId("connection-1");
  assert.equal(connection.status, "reauthorization_required");
  assert.equal(connection.accessToken, null);
  assert.equal(connection.refreshToken, null);

  await assert.rejects(
    service.getAuthorizationHeaders("connection-1"),
    { code: "XERO_REAUTHORIZATION_REQUIRED", status: 401 },
  );
  assert.equal(refreshCalls, 1);
});

test("keeps a connection retryable when Xero has a temporary token endpoint failure", async () => {
  const store = createConnectionStore();
  await store.save({
    connectionId: "connection-1",
    tenantId: "tenant-1",
    accessToken: "expired-access",
    refreshToken: "valid-refresh",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const service = new XeroOAuthService({
    config,
    stateStore: new OAuthStateStore(),
    connectionStore: store,
    fetchImpl: async () => new Response(
      JSON.stringify({ error: "temporarily_unavailable" }),
      { status: 503 },
    ),
  });

  await assert.rejects(
    service.getAuthorizationHeaders("connection-1"),
    { code: "XERO_TOKEN_EXCHANGE_FAILED", status: 502 },
  );
  const connection = await store.getByConnectionId("connection-1");
  assert.notEqual(connection.status, "reauthorization_required");
  assert.equal(connection.refreshToken, "valid-refresh");
});
