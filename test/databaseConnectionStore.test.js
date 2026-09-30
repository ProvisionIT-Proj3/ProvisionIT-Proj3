const test = require("node:test");
const assert = require("node:assert/strict");
const TokenCipher = require("../src/auth/core/tokenCipher");
const DatabaseConnectionStore = require("../src/auth/core/databaseConnectionStore");

function createFakePersistence() {
  const rows = new Map();
  return {
    rows,
    async saveOAuthConnection(connection) {
      const row = {
        connection_id: connection.connectionId,
        platform: connection.provider,
        external_connection_id: connection.externalConnectionId,
        provider_account_id: connection.providerAccountId,
        oauth_grant_id: connection.oauthGrantId,
        company_name: connection.accountName,
        provider_metadata: connection.metadata,
        status: "active",
        date_connected: "2026-09-13T00:00:00.000Z",
        token_expires_at: connection.expiresAt,
        access_token: connection.accessTokenEncrypted,
        refresh_token: connection.refreshTokenEncrypted,
      };
      rows.set(connection.connectionId, row);
      return row;
    },
    async getOAuthConnectionById(connectionId, provider) {
      if (rows.get(connectionId)?.platform !== provider) return null;
      return rows.get(connectionId) || null;
    },
    async updateOAuthGrantTokens(connectionId, provider, tokens) {
      const row = rows.get(connectionId);
      if (!row || row.platform !== provider) return null;
      let requestedRow;
      for (const [id, candidate] of rows) {
        if (candidate.oauth_grant_id !== row.oauth_grant_id) continue;
        const updated = {
          ...candidate,
          access_token: tokens.accessTokenEncrypted,
          refresh_token: tokens.refreshTokenEncrypted,
          token_expires_at: tokens.expiresAt,
        };
        rows.set(id, updated);
        if (id === connectionId) requestedRow = updated;
      }
      return requestedRow;
    },
    async deleteOAuthConnection(connectionId) {
      rows.delete(connectionId);
    },
    async listOAuthConnections(provider) {
      return [...rows.values()]
        .filter((row) => row.platform === provider)
        .map(({ access_token, refresh_token, ...row }) => row);
    },
    async markOAuthGrantReauthorizationRequired(connectionId, provider) {
      const row = rows.get(connectionId);
      if (!row || row.platform !== provider) return null;
      let requestedRow;
      for (const [id, candidate] of rows) {
        if (candidate.oauth_grant_id !== row.oauth_grant_id) continue;
        const updated = {
          ...candidate,
          status: "reauthorization_required",
          token_expires_at: null,
          access_token: null,
          refresh_token: null,
        };
        rows.set(id, updated);
        if (id === connectionId) requestedRow = updated;
      }
      return requestedRow;
    },
  };
}

function createStore(persistence = createFakePersistence()) {
  return {
    persistence,
    store: new DatabaseConnectionStore({
      provider: "xero",
      persistence,
      tokenCipher: new TokenCipher({ key: Buffer.alloc(32, 4), keyVersion: "test" }),
    }),
  };
}

test("database store reports an incomplete OAuth persistence contract", () => {
  assert.throws(
    () => new DatabaseConnectionStore({ provider: "xero", persistence: {} }),
    /saveOAuthConnection.*updateOAuthGrantTokens.*markOAuthGrantReauthorizationRequired/,
  );
});

test("database store persists encrypted token envelopes and decrypts them for OAuth", async () => {
  const { persistence, store } = createStore();
  const saved = await store.save({
    connectionId: "connection-1",
    provider: "xero",
    externalConnectionId: "xero-connection-1",
    providerAccountId: "tenant-1",
    oauthGrantId: "grant-1",
    accountName: "Demo Company",
    metadata: { tenantType: "ORGANISATION" },
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  const rawRow = persistence.rows.get("connection-1");
  assert.doesNotMatch(JSON.stringify(rawRow), /secret-access|secret-refresh/);
  assert.equal(JSON.parse(rawRow.access_token).algorithm, "aes-256-gcm");
  assert.equal(saved.accessToken, "secret-access");
  assert.equal(saved.refreshToken, "secret-refresh");
});

test("database store replaces encrypted tokens during refresh", async () => {
  const { persistence, store } = createStore();
  await store.save({
    connectionId: "connection-1",
    provider: "xero",
    externalConnectionId: "xero-connection-1",
    providerAccountId: "tenant-1",
    oauthGrantId: "grant-1",
    accountName: "Demo Company",
    metadata: { tenantType: "ORGANISATION" },
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  await store.save({
    connectionId: "connection-2",
    provider: "xero",
    externalConnectionId: "xero-connection-2",
    providerAccountId: "tenant-2",
    oauthGrantId: "grant-1",
    accountName: "Second Company",
    metadata: { tenantType: "ORGANISATION" },
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });
  const oldCiphertext = persistence.rows.get("connection-1").access_token;

  const updated = await store.updateTokens("connection-1", {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  assert.notEqual(persistence.rows.get("connection-1").access_token, oldCiphertext);
  assert.equal(updated.accessToken, "new-access");
  assert.equal(updated.refreshToken, "new-refresh");
  assert.equal((await store.getByConnectionId("connection-2")).refreshToken, "new-refresh");
});

test("database connection listings contain no token fields", async () => {
  const { store } = createStore();
  await store.save({
    connectionId: "connection-1",
    provider: "xero",
    externalConnectionId: "xero-connection-1",
    providerAccountId: "tenant-1",
    oauthGrantId: "grant-1",
    accountName: "Demo Company",
    metadata: { tenantType: "ORGANISATION" },
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  const connections = await store.list();
  assert.equal(connections.length, 1);
  assert.doesNotMatch(JSON.stringify(connections), /token|cipher|authTag/i);
});

test("database store clears unusable tokens and marks reauthorization required", async () => {
  const { persistence, store } = createStore();
  await store.save({
    connectionId: "connection-1",
    provider: "xero",
    externalConnectionId: "xero-connection-1",
    providerAccountId: "tenant-1",
    oauthGrantId: "grant-1",
    accountName: "Demo Company",
    metadata: { tenantType: "ORGANISATION" },
    accessToken: "expired-access",
    refreshToken: "expired-refresh",
    expiresAt: "2026-01-01T00:00:00.000Z",
  });

  await store.markReauthorizationRequired("connection-1");

  const rawRow = persistence.rows.get("connection-1");
  assert.equal(rawRow.status, "reauthorization_required");
  assert.equal(rawRow.access_token, null);
  assert.equal(rawRow.refresh_token, null);
});
