const REQUIRED_CONNECTION_METHODS = [
  "createConnection",
  "saveTokens",
  "getConnectionById",
  "listConnections",
  "deleteConnection",
];

class ConnectionPersistenceAdapter {
  constructor(persistence) {
    const missingMethods = REQUIRED_CONNECTION_METHODS.filter(
      (method) => typeof persistence?.[method] !== "function",
    );
    if (missingMethods.length) {
      throw new Error(`Connection persistence is missing required methods: ${missingMethods.join(", ")}.`);
    }
    this.persistence = persistence;
  }

  async saveOAuthConnection(connection) {
    const created = await this.persistence.createConnection({
      connectionId: connection.connectionId,
      companyName: connection.accountName,
      platform: connection.provider,
      externalConnectionId: connection.externalConnectionId,
      externalAccountId: connection.providerAccountId,
      oauthGrantId: connection.oauthGrantId,
      providerMetadata: connection.metadata,
    });
    const connectionId = created?.connection_id || connection.connectionId;
    await this.persistence.saveTokens(connectionId, {
      accessToken: connection.accessTokenEncrypted,
      refreshToken: connection.refreshTokenEncrypted,
      expiresAt: connection.expiresAt,
      status: "active",
    });
    return this.persistence.getConnectionById(connectionId);
  }

  async getOAuthConnectionById(connectionId, provider) {
    const row = await this.persistence.getConnectionById(connectionId);
    return row?.platform === provider ? row : null;
  }

  async updateOAuthGrantTokens(connectionId, provider, tokens) {
    const existing = await this.getOAuthConnectionById(connectionId, provider);
    if (!existing) return null;
    await this.persistence.saveTokens(connectionId, {
      accessToken: tokens.accessTokenEncrypted,
      refreshToken: tokens.refreshTokenEncrypted,
      expiresAt: tokens.expiresAt,
      status: "active",
    });
    return this.persistence.getConnectionById(connectionId);
  }

  async deleteOAuthConnection(connectionId, provider) {
    const existing = await this.getOAuthConnectionById(connectionId, provider);
    if (!existing) return { deleted: false };
    return this.persistence.deleteConnection(connectionId);
  }

  async listOAuthConnections(provider) {
    const rows = await this.persistence.listConnections();
    return rows.filter((row) => row.platform === provider);
  }

  async markOAuthGrantReauthorizationRequired(connectionId, provider) {
    const existing = await this.getOAuthConnectionById(connectionId, provider);
    if (!existing) return null;
    await this.persistence.saveTokens(connectionId, {
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      status: "reauthorization_required",
    });
    return this.persistence.getConnectionById(connectionId);
  }
}

module.exports = ConnectionPersistenceAdapter;
