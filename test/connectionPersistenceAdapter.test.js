const test = require("node:test");
const assert = require("node:assert/strict");
const ConnectionPersistenceAdapter = require("../src/auth/core/connectionPersistenceAdapter");

function createGioPersistence() {
  const rows = new Map();
  return {
    rows,
    async createConnection(connection) {
      const row = {
        connection_id: connection.connectionId,
        company_name: connection.companyName,
        platform: connection.platform,
        external_connection_id: connection.externalConnectionId,
        external_account_id: connection.externalAccountId,
        oauth_grant_id: connection.oauthGrantId,
        provider_metadata: connection.providerMetadata,
        status: "active",
      };
      rows.set(row.connection_id, row);
      return row;
    },
    async saveTokens(connectionId, tokens) {
      const selected = rows.get(connectionId);
      if (!selected) return null;
      let requestedRow;
      for (const [id, row] of rows) {
        if (row.oauth_grant_id !== selected.oauth_grant_id) continue;
        const updated = {
          ...row,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.expiresAt,
          status: tokens.status,
        };
        rows.set(id, updated);
        if (id === connectionId) requestedRow = updated;
      }
      return requestedRow;
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

test("adapter only requires Gio's five existing persistence methods", () => {
  assert.doesNotThrow(() => new ConnectionPersistenceAdapter(createGioPersistence()));
  assert.throws(
    () => new ConnectionPersistenceAdapter({}),
    /createConnection.*saveTokens.*getConnectionById.*listConnections.*deleteConnection/,
  );
});

test("adapter maps generic OAuth fields to the shared connection persistence", async () => {
  const persistence = createGioPersistence();
  const adapter = new ConnectionPersistenceAdapter(persistence);
  const saved = await adapter.saveOAuthConnection({
    connectionId: "connection-1",
    provider: "quickbooks",
    externalConnectionId: null,
    providerAccountId: "realm-1",
    oauthGrantId: "grant-1",
    accountName: "QuickBooks Company",
    metadata: { country: "AU" },
    accessTokenEncrypted: "encrypted-access",
    refreshTokenEncrypted: "encrypted-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });

  assert.equal(saved.external_account_id, "realm-1");
  assert.equal(saved.access_token, "encrypted-access");
  assert.equal(saved.status, "active");
});

test("adapter delegates grant-wide refresh and reauthorization to saveTokens", async () => {
  const persistence = createGioPersistence();
  const adapter = new ConnectionPersistenceAdapter(persistence);
  for (const connectionId of ["connection-1", "connection-2"]) {
    await adapter.saveOAuthConnection({
      connectionId,
      provider: "xero",
      externalConnectionId: `external-${connectionId}`,
      providerAccountId: `account-${connectionId}`,
      oauthGrantId: "grant-1",
      accountName: connectionId,
      metadata: {},
      accessTokenEncrypted: "old-access",
      refreshTokenEncrypted: "old-refresh",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
  }

  await adapter.updateOAuthGrantTokens("connection-1", "xero", {
    accessTokenEncrypted: "new-access",
    refreshTokenEncrypted: "new-refresh",
    expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(persistence.rows.get("connection-2").refresh_token, "new-refresh");

  await adapter.markOAuthGrantReauthorizationRequired("connection-1", "xero");
  assert.equal(persistence.rows.get("connection-2").status, "reauthorization_required");
  assert.equal(persistence.rows.get("connection-2").refresh_token, null);
});
