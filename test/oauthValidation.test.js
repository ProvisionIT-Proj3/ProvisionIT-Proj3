const test = require("node:test");
const assert = require("node:assert/strict");
const { assertRedirectUri, buildRelativeApiUrl } = require("../src/auth/core/urlValidation");
const OAuthStateStore = require("../src/auth/core/stateStore");
const OAuthService = require("../src/auth/core/oauthService");

test("redirects allow HTTPS and local HTTP without embedded credentials", () => {
  for (const value of ["https://portal.example/callback", "http://localhost:3000/callback"]) {
    assert.doesNotThrow(() => assertRedirectUri(value, "REDIRECT_URI"));
  }
  for (const value of ["ftp://localhost/callback", "javascript:alert(1)", "http://portal.example/callback",
    "https://user:secret@portal.example/callback", "https://portal.example/callback#token", "relative/path"]) {
    assert.throws(() => assertRedirectUri(value, "REDIRECT_URI"), { code: "INVALID_OAUTH_CONFIGURATION" });
  }
});

test("provider paths cannot escape the API origin or company directory", () => {
  for (const base of ["https://api.xero.com/api.xro/2.0/", "https://sandbox-quickbooks.api.intuit.com/v3/company/123/"]) {
    assert.equal(buildRelativeApiUrl("query?query=select%20*%20from%20Account", base, "Provider", "BAD_PATH"),
      `${base}query?query=select%20*%20from%20Account`);
    for (const path of ["https://other.example/", "//other.example/", "\\\\other.example/", "../other",
      "%2e%2e/other", "%2e%2e%2fother", "Accounts\\..\\other", "\t//other.example/", "Accounts#fragment", "%zz"]) {
      assert.throws(() => buildRelativeApiUrl(path, base, "Provider", "BAD_PATH"), { code: "BAD_PATH" });
    }
  }
});

test("OAuth state expires at its boundary and cannot be consumed twice", () => {
  let now = 1000;
  const store = new OAuthStateStore({ ttlMs: 100, clock: () => now });
  const first = store.create({ provider: "xero", actorUserId: "admin" });
  assert.equal(store.consume(first).actorUserId, "admin");
  assert.equal(store.consume(first), null);
  const expired = store.create();
  now = 1100;
  assert.equal(store.consume(expired), null);
  assert.equal(store.consume(["state"]), null);
});

test("refresh preserves the previous refresh token when no replacement is returned", async () => {
  let storedTokens;
  const service = new OAuthService({
    provider: {
      id: "xero",
      refreshTokens: async () => ({ access_token: "new-access", expires_in: 3600 }),
      isReauthorizationError: () => false,
    },
    connectionStore: {
      async updateTokens(connectionId, tokens) { storedTokens = tokens; return { connectionId, ...tokens }; },
    },
  });
  await service.refreshConnection("connection", { refreshToken: "valid-refresh" });
  assert.equal(storedTokens.refreshToken, "valid-refresh");
  assert.equal(storedTokens.accessToken, "new-access");
});

test("malformed provider tokens never overwrite stored credentials", async () => {
  let writes = 0;
  for (const tokens of [null, {}, { access_token: "access", expires_in: "NaN" },
    { access_token: "access", expires_in: -1 }, { access_token: "access", expires_in: 3600, refresh_token: [] }]) {
    const service = new OAuthService({
      provider: { id: "xero", refreshTokens: async () => tokens, isReauthorizationError: () => false },
      connectionStore: { async updateTokens() { writes += 1; } },
    });
    await assert.rejects(service.refreshConnection("connection", { refreshToken: "valid-refresh" }),
      { code: "INVALID_OAUTH_TOKEN_RESPONSE" });
  }
  assert.equal(writes, 0);
});
