const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/oauth/xero/stateStore");
const XeroConnectionStore = require("../src/auth/oauth/xero/connectionStore");
const XeroOAuthService = require("../src/auth/oauth/xero/service");

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/auth/xero/callback",
  scopes: ["offline_access", "accounting.contacts"],
  authorizationUrl: "https://login.xero.com/identity/connect/authorize",
  tokenUrl: "https://identity.xero.com/connect/token",
  connectionsUrl: "https://api.xero.com/connections",
};

test("creates an Xero authorization URL with an opaque state", () => {
  const stateStore = new OAuthStateStore();
  const service = new XeroOAuthService({ config, stateStore, connectionStore: new XeroConnectionStore() });

  const url = new URL(service.getAuthorizationUrl());
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), config.clientId);
  assert.equal(url.searchParams.get("scope"), "offline_access accounting.contacts");
  assert.ok(url.searchParams.get("state").length >= 40);
});

test("exchanges a verified code and stores only connection metadata for reads", async () => {
  const stateStore = new OAuthStateStore();
  const calls = [];
  const service = new XeroOAuthService({
    config,
    stateStore,
    connectionStore: new XeroConnectionStore(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === config.tokenUrl) {
        return new Response(JSON.stringify({ access_token: "secret-access", refresh_token: "secret-refresh", expires_in: 1800 }), { status: 200 });
      }
      return new Response(JSON.stringify([{ tenantId: "tenant-1", tenantName: "Demo Company", tenantType: "ORGANISATION" }]), { status: 200 });
    },
  });
  const state = new URL(service.getAuthorizationUrl()).searchParams.get("state");

  const connections = await service.completeAuthorization({ code: "one-time-code", state });

  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[1].options.headers.Authorization, "Bearer secret-access");
  assert.deepEqual(connections, [{ tenantId: "tenant-1", tenantName: "Demo Company", tenantType: "ORGANISATION", createdAt: undefined, updatedAt: undefined, expiresAt: connections[0].expiresAt }]);
  assert.deepEqual(service.listConnections(), connections);
});

test("rejects a callback whose state is unknown or has already been consumed", async () => {
  const service = new XeroOAuthService({ config, stateStore: new OAuthStateStore(), connectionStore: new XeroConnectionStore() });
  await assert.rejects(
    service.completeAuthorization({ code: "code", state: "unknown" }),
    { code: "INVALID_OAUTH_STATE", status: 400 },
  );
});
