const test = require("node:test");
const assert = require("node:assert/strict");
const ConnectionPersistenceAdapter = require("../src/auth/core/connectionPersistenceAdapter");

function createGioPersistence() {
  const rows = new Map();
  const credentials = new Map();
  const clients = [];
  const transactionClient = { transaction: true };
  let nextCredential = 1;
  return {
    rows,
    credentials,
    clients,
    async withTransaction(fn) {
      return fn(transactionClient);
    },
    async createConnection(connection, client) {
      clients.push(client);
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
    async createCredential({ platform, status }, client) {
      clients.push(client);
      const row = {
        credential_id: `credential-${nextCredential++}`,
        platform,
        status,
      };
      credentials.set(row.credential_id, row);
      return row;
    },
    async updateCredentialTokens(credentialId, tokens, client) {
      clients.push(client);
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
    async linkConnectionToCredential(connectionId, credentialId, client) {
      clients.push(client);
      const updated = { ...rows.get(connectionId), credential_id: credentialId };
      rows.set(connectionId, updated);
      return updated;
    },
    async getTokensForConnection(connectionId, client) {
      clients.push(client);
      const row = rows.get(connectionId);
      return row ? credentials.get(row.credential_id) : null;
    },
    async getConnectionById(connectionId, client) {
      clients.push(client);
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
    /withTransaction.*createConnection.*createCredential.*updateCredentialTokens.*linkConnectionToCredential.*getTokensForConnection/,
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

test("adapter keeps OAuth writes and reads on the transaction client", async () => {
  const persistence = createGioPersistence();
  const adapter = new ConnectionPersistenceAdapter(persistence);

  await adapter.withTransaction(async (client) => {
    const credential = await adapter.createOAuthCredential("xero", client);
    await adapter.updateOAuthCredentialTokens(credential.credential_id, {
      accessTokenEncrypted: "encrypted-access",
      refreshTokenEncrypted: "encrypted-refresh",
      expiresAt: "2030-01-01T00:00:00.000Z",
      status: "active",
    }, client);
    await adapter.saveOAuthConnection({
      connectionId: "connection-1",
      provider: "xero",
      externalConnectionId: "external-1",
      providerAccountId: "tenant-1",
      accountName: "Example Company",
      metadata: {},
    }, credential.credential_id, client);
  });

  assert.equal(persistence.clients.length, 6);
  assert.ok(persistence.clients.every((client) => client?.transaction === true));
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
