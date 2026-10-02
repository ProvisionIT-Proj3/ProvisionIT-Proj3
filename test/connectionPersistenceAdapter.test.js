const test = require("node:test");
const assert = require("node:assert/strict");
const ConnectionPersistenceAdapter = require("../src/auth/core/connectionPersistenceAdapter");

function createGioPersistence() {
  const rows = new Map();
  const credentials = new Map();
  let nextCredential = 1;
  return {
    rows,
    credentials,
    async createConnection(connection) {
      const row = {
        connection_id: connection.connectionId,
        company_name: connection.companyName,
        platform: connection.platform,
        external_connection_id: connection.externalConnectionId,
        external_account_id: connection.externalAccountId,
        provider_metadata: connection.providerMetadata,
        status: "active",
      };
      rows.set(row.connection_id, row);
      return row;
    },
    async createCredential({ platform, status }) {
      const row = {
        credential_id: `credential-${nextCredential++}`,
        platform,
        status,
      };
      credentials.set(row.credential_id, row);
      return row;
    },
    async updateCredentialTokens(credentialId, tokens) {
      const existing = credentials.get(credentialId);
      const updated = {
        ...existing,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        token_expires_at: tokens.expiresAt,
        status: tokens.status,
      };
      credentials.set(credentialId, updated);
      return updated;
    },
    async linkConnectionToCredential(connectionId, credentialId) {
      const updated = { ...rows.get(connectionId), credential_id: credentialId };
      rows.set(connectionId, updated);
      return updated;
    },
    async getTokensForConnection(connectionId) {
      const row = rows.get(connectionId);
      return row ? credentials.get(row.credential_id) : null;
    },
    async getConnectionById(connectionId) {
      return rows.get(connectionId) || null;
    },
    async listConnections() {
      return [...rows.values()];
    },
    async deleteConnection(connectionId) {
      return { deleted: rows.delete(connectionId) };
    },
  };
}

test("adapter requires Gio's connection and credential persistence methods", () => {
  assert.doesNotThrow(() => new ConnectionPersistenceAdapter(createGioPersistence()));
  assert.throws(
    () => new ConnectionPersistenceAdapter({}),
    /createConnection.*createCredential.*updateCredentialTokens.*linkConnectionToCredential.*getTokensForConnection/,
  );
});

test("adapter maps provider-neutral connection fields and joins its credential", async () => {
  const persistence = createGioPersistence();
  const adapter = new ConnectionPersistenceAdapter(persistence);
  const credential = await adapter.createOAuthCredential("quickbooks");
  await adapter.updateOAuthCredentialTokens(credential.credential_id, {
    accessTokenEncrypted: "encrypted-access",
    refreshTokenEncrypted: "encrypted-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
    status: "active",
  });
  const saved = await adapter.saveOAuthConnection({
    connectionId: "connection-1",
    provider: "quickbooks",
    externalConnectionId: null,
    providerAccountId: "realm-1",
    accountName: "QuickBooks Company",
    metadata: { country: "AU" },
  }, credential.credential_id);

  assert.equal(saved.external_account_id, "realm-1");
  assert.equal(saved.credential_id, credential.credential_id);
  assert.equal(saved.access_token, "encrypted-access");
  assert.equal(saved.credential_status, "active");
});

test("two connections can share one credential without duplicating tokens", async () => {
  const persistence = createGioPersistence();
  const adapter = new ConnectionPersistenceAdapter(persistence);
  const credential = await adapter.createOAuthCredential("xero");
  await adapter.updateOAuthCredentialTokens(credential.credential_id, {
    accessTokenEncrypted: "old-access",
    refreshTokenEncrypted: "old-refresh",
    expiresAt: "2026-01-01T00:00:00.000Z",
    status: "active",
  });
  for (const connectionId of ["connection-1", "connection-2"]) {
    await adapter.saveOAuthConnection({
      connectionId,
      provider: "xero",
      externalConnectionId: `external-${connectionId}`,
      providerAccountId: `account-${connectionId}`,
      accountName: connectionId,
      metadata: {},
    }, credential.credential_id);
  }

  await adapter.updateOAuthCredentialTokens(credential.credential_id, {
    accessTokenEncrypted: "new-access",
    refreshTokenEncrypted: "new-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
    status: "active",
  });

  assert.equal(persistence.credentials.size, 1);
  assert.equal((await adapter.getOAuthConnectionById("connection-2", "xero")).refresh_token, "new-refresh");
});
