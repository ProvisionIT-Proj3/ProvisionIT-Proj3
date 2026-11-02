const test = require("node:test");
const assert = require("node:assert/strict");
const OAuthStateStore = require("../src/auth/core/stateStore");
const TestMemoryConnectionStore = require("../src/auth/core/testMemoryConnectionStore");
const OAuthService = require("../src/auth/core/oauthService");
const TokenCipher = require("../src/auth/core/tokenCipher");
const XeroProvider = require("../src/auth/providers/xero/provider");
const { sanitizeMetadata } = require("../src/security/auditLogger");

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

test("the audit log keeps a company name", () => {
  assert.deepEqual(sanitizeMetadata({ companyName: "Riverbend Cafe", password: "x" }), { companyName: "Riverbend Cafe" });
});

test("connecting and disconnecting record the company name, which is gone from the database afterwards", async () => {
  const events = [];
  const ids = ["connection-1"];
  const service = new OAuthService({
    provider,
    stateStore: new OAuthStateStore(),
    connectionStore: createStore(),
    auditLogger: { record: async (event) => events.push(event) },
    idFactory: () => ids.shift(),
    fetchImpl: async (url) => {
      if (url === "https://identity.xero.com/connect/token") {
        return new Response(JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 1800 }), { status: 200 });
      }
      if (url === "https://api.xero.com/connections") {
        return new Response(JSON.stringify([{ id: "x1", tenantId: "t1", tenantName: "Riverbend Cafe", tenantType: "ORGANISATION" }]), { status: 200 });
      }
      return new Response(null, { status: 204 });
    },
  });
  const state = new URL(service.getAuthorizationUrl()).searchParams.get("state");

  await service.completeAuthorization({ code: "code", state });
  await service.disconnect("connection-1");

  const created = events.find((e) => e.action === "connection.created");
  const removed = events.find((e) => e.action === "connection.disconnected" && e.outcome === "success");
  assert.equal(created.metadata.companyName, "Riverbend Cafe");
  assert.equal(removed.metadata.companyName, "Riverbend Cafe");
});
