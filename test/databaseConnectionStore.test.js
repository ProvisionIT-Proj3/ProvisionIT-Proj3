const test = require("node:test");
const assert = require("node:assert/strict");
const TokenCipher = require("../src/auth/core/tokenCipher");
const DatabaseConnectionStore = require("../src/auth/core/databaseConnectionStore");

function createFakePersistence() {
  const rows = new Map();
  const credentials = new Map();
  let nextCredential = 1;

  function combined(connectionId) {
    const row = rows.get(connectionId);
    if (!row) return null;
    const credential = credentials.get(row.credential_id);
    return {
      ...row,
      credential_status: credential?.status,
      access_token: credential?.access_token,
      refresh_token: credential?.refresh_token,
      token_expires_at: credential?.token_expires_at,
    };
  }

  return {
    rows,
    credentials,
    async createOAuthCredential(provider) {
      const row = {
        credential_id: `credential-${nextCredential++}`,
        platform: provider,
        status: "active",
      };
      credentials.set(row.credential_id, row);
      return row;
    },
    async updateOAuthCredentialTokens(credentialId, tokens) {
      const existing = credentials.get(credentialId);
      credentials.set(credentialId, {
        ...existing,
        access_token: tokens.accessTokenEncrypted,
        refresh_token: tokens.refreshTokenEncrypted,
        token_expires_at: tokens.expiresAt,
        status: tokens.status,
      });
    },
    async saveOAuthConnection(connection, credentialId) {
      const row = {
        connection_id: connection.connectionId,
        credential_id: credentialId,
        platform: connection.provider,
        external_connection_id: connection.externalConnectionId,
        external_account_id: connection.providerAccountId,
        company_name: connection.accountName,
        provider_metadata: connection.metadata,
        status: "active",
        date_connected: "2026-09-13T00:00:00.000Z",
      };
      rows.set(connection.connectionId, row);
      return combined(connection.connectionId);
    },
    async getOAuthConnectionById(connectionId, provider) {
      if (rows.get(connectionId)?.platform !== provider) return null;
      return combined(connectionId);
    },
    async deleteOAuthConnection(connectionId) {
      return { deleted: rows.delete(connectionId) };
    },
    async listOAuthConnections(provider) {
      return [...rows.values()]
        .filter((row) => row.platform === provider)
        .map((row) => combined(row.connection_id));
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

function connection(connectionId, accountId) {
  return {
    connectionId,
    provider: "xero",
    externalConnectionId: `xero-${connectionId}`,
    providerAccountId: accountId,
    accountName: accountId,
    metadata: { tenantType: "ORGANISATION" },
  };
}

test("database store reports an incomplete OAuth persistence contract", () => {
  assert.throws(
    () => new DatabaseConnectionStore({ provider: "xero", persistence: {} }),
    /createOAuthCredential.*updateOAuthCredentialTokens.*saveOAuthConnection/,
  );
});

test("database store persists one encrypted credential for an authorization", async () => {
  const { persistence, store } = createStore();
  const [saved] = await store.saveAuthorization(
    [connection("connection-1", "tenant-1")],
    {
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      expiresAt: "2030-01-01T00:00:00.000Z",
    },
  );

  const rawCredential = [...persistence.credentials.values()][0];
  assert.doesNotMatch(JSON.stringify(rawCredential), /secret-access|secret-refresh/);
  assert.equal(JSON.parse(rawCredential.access_token).algorithm, "aes-256-gcm");
  assert.equal(saved.accessToken, "secret-access");
  assert.equal(saved.refreshToken, "secret-refresh");
  assert.equal(persistence.rows.get("connection-1").credential_id, rawCredential.credential_id);
});

test("shared Xero connections read refreshed tokens from one credential", async () => {
  const { persistence, store } = createStore();
  await store.saveAuthorization(
    [connection("connection-1", "tenant-1"), connection("connection-2", "tenant-2")],
    {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
  );
  const credentialId = persistence.rows.get("connection-1").credential_id;
  const oldCiphertext = persistence.credentials.get(credentialId).access_token;

  const updated = await store.updateTokens("connection-1", {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  assert.equal(persistence.credentials.size, 1);
  assert.notEqual(persistence.credentials.get(credentialId).access_token, oldCiphertext);
  assert.equal(updated.accessToken, "new-access");
  assert.equal((await store.getByConnectionId("connection-2")).refreshToken, "new-refresh");
});

test("database connection listings contain no token fields", async () => {
  const { store } = createStore();
  await store.saveAuthorization([connection("connection-1", "tenant-1")], {
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  const connections = await store.list();
  assert.equal(connections.length, 1);
  assert.doesNotMatch(JSON.stringify(connections), /accessToken|refreshToken|cipher|authTag/i);
});

test("database store clears one shared credential after a rejected refresh", async () => {
  const { persistence, store } = createStore();
  await store.saveAuthorization(
    [connection("connection-1", "tenant-1"), connection("connection-2", "tenant-2")],
    {
      accessToken: "expired-access",
      refreshToken: "expired-refresh",
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
  );

  await store.markReauthorizationRequired("connection-1");

  const credentialId = persistence.rows.get("connection-1").credential_id;
  const rawCredential = persistence.credentials.get(credentialId);
  assert.equal(rawCredential.status, "reauthorization_required");
  assert.equal(rawCredential.access_token, null);
  assert.equal(rawCredential.refresh_token, null);
  assert.equal((await store.getByConnectionId("connection-2")).status, "reauthorization_required");
});
