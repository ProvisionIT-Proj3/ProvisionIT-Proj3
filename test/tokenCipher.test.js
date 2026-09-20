const test = require("node:test");
const assert = require("node:assert/strict");
const TokenCipher = require("../src/auth/core/tokenCipher");
const TestMemoryConnectionStore = require("../src/auth/core/testMemoryConnectionStore");

const key = Buffer.alloc(32, 9);

test("encrypts and decrypts a token with authenticated encryption", () => {
  const tokenCipher = new TokenCipher({ key, keyVersion: "test" });
  const first = tokenCipher.encrypt("secret-token", "xero:connection-1:access");
  const second = tokenCipher.encrypt("secret-token", "xero:connection-1:access");

  assert.equal(tokenCipher.decrypt(first, "xero:connection-1:access"), "secret-token");
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.notEqual(first.iv, second.iv);
  assert.equal(first.keyVersion, "test");
});

test("rejects modified encrypted token data", () => {
  const tokenCipher = new TokenCipher({ key, keyVersion: "test" });
  const encrypted = tokenCipher.encrypt("secret-token", "xero:connection-1:access");
  encrypted.ciphertext = Buffer.from("modified-token").toString("base64");

  assert.throws(
    () => tokenCipher.decrypt(encrypted, "xero:connection-1:access"),
    /integrity validation/,
  );
});

test("stores encrypted token fields instead of plaintext token values", async () => {
  const tokenCipher = new TokenCipher({ key, keyVersion: "test" });
  const store = new TestMemoryConnectionStore({ provider: "xero", tokenCipher });
  await store.save({
    connectionId: "connection-1",
    provider: "xero",
    providerAccountId: "tenant-1",
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  const stored = store.connections.get("connection-1");
  assert.equal(stored.accessToken, undefined);
  assert.equal(stored.refreshToken, undefined);
  assert.ok(stored.accessTokenEncrypted.ciphertext);
  assert.ok(stored.refreshTokenEncrypted.ciphertext);
  assert.doesNotMatch(JSON.stringify(stored), /secret-access|secret-refresh/);

  const decrypted = await store.getByConnectionId("connection-1");
  assert.equal(decrypted.accessToken, "secret-access");
  assert.equal(decrypted.refreshToken, "secret-refresh");
});

test("requires a valid 32-byte base64 environment key", () => {
  assert.throws(
    () => TokenCipher.fromEnvironment({ TOKEN_ENCRYPTION_KEY: "too-short" }),
    /base64-encoded 32-byte key/,
  );
});
