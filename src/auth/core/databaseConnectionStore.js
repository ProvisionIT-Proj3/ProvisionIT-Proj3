const TokenCipher = require("./tokenCipher");

function toIsoString(value) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value) {
  if (!value) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function mapDatabaseRow(row) {
  if (!row) return null;
  return {
    connectionId: row.connection_id,
    provider: row.platform,
    providerAccountId: row.provider_account_id,
    accountName: row.company_name,
    metadata: parseJson(row.provider_metadata) || {},
    status: row.status,
    createdAt: toIsoString(row.date_connected),
    expiresAt: toIsoString(row.token_expires_at),
    accessTokenEncrypted: parseJson(row.access_token),
    refreshTokenEncrypted: parseJson(row.refresh_token),
  };
}

class DatabaseConnectionStore {
  constructor({ provider, persistence, tokenCipher } = {}) {
    if (!provider) throw new Error("An OAuth provider id is required.");
    if (!persistence) throw new Error("OAuth database persistence is required.");
    this.provider = provider;
    this.persistence = persistence;
    this.tokenCipher = tokenCipher || TokenCipher.fromEnvironment();
  }

  tokenContext(connectionId, tokenType) {
    return `${this.provider}:${connectionId}:${tokenType}`;
  }

  encryptToken(connectionId, tokenType, token) {
    return JSON.stringify(this.tokenCipher.encrypt(token, this.tokenContext(connectionId, tokenType)));
  }

  decryptConnection(row) {
    const stored = mapDatabaseRow(row);
    if (!stored) return null;
    const { accessTokenEncrypted, refreshTokenEncrypted, ...connection } = stored;
    return {
      ...connection,
      accessToken: accessTokenEncrypted
        ? this.tokenCipher.decrypt(accessTokenEncrypted, this.tokenContext(connection.connectionId, "access"))
        : null,
      refreshToken: refreshTokenEncrypted
        ? this.tokenCipher.decrypt(refreshTokenEncrypted, this.tokenContext(connection.connectionId, "refresh"))
        : null,
    };
  }

  async save(connection) {
    if (connection.provider !== this.provider) throw new Error("Connection provider does not match its store.");
    const row = await this.persistence.saveOAuthConnection({
      ...connection,
      accessTokenEncrypted: this.encryptToken(connection.connectionId, "access", connection.accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.connectionId, "refresh", connection.refreshToken),
    });
    return this.decryptConnection(row);
  }

  async getByConnectionId(connectionId) {
    return this.decryptConnection(await this.persistence.getOAuthConnectionById(connectionId, this.provider));
  }

  async updateTokens(connectionId, tokens) {
    const row = await this.persistence.updateOAuthTokens(connectionId, this.provider, {
      accessTokenEncrypted: this.encryptToken(connectionId, "access", tokens.accessToken),
      refreshTokenEncrypted: this.encryptToken(connectionId, "refresh", tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    });
    return this.decryptConnection(row);
  }

  async deleteByConnectionId(connectionId) {
    await this.persistence.deleteOAuthConnection(connectionId, this.provider);
    return true;
  }

  async markReauthorizationRequired(connectionId) {
    return this.persistence.markOAuthReauthorizationRequired(connectionId, this.provider);
  }

  async list() {
    const rows = await this.persistence.listOAuthConnections(this.provider);
    return rows.map((row) => {
      const { accessTokenEncrypted, refreshTokenEncrypted, ...connection } = mapDatabaseRow(row);
      return connection;
    });
  }
}

module.exports = DatabaseConnectionStore;
