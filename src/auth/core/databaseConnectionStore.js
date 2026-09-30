const TokenCipher = require("./tokenCipher");

const REQUIRED_PERSISTENCE_METHODS = [
  "saveOAuthConnection",
  "getOAuthConnectionById",
  "updateOAuthGrantTokens",
  "deleteOAuthConnection",
  "listOAuthConnections",
  "markOAuthGrantReauthorizationRequired",
];

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
    externalConnectionId: row.external_connection_id,
    providerAccountId: row.external_account_id ?? row.provider_account_id,
    oauthGrantId: row.oauth_grant_id,
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
    const missingMethods = REQUIRED_PERSISTENCE_METHODS.filter(
      (method) => typeof persistence[method] !== "function",
    );
    if (missingMethods.length) {
      throw new Error(`OAuth persistence is missing required methods: ${missingMethods.join(", ")}.`);
    }
    this.provider = provider;
    this.persistence = persistence;
    this.tokenCipher = tokenCipher || TokenCipher.fromEnvironment();
  }

  tokenContext(credentialContextId, tokenType) {
    return `${this.provider}:${credentialContextId}:${tokenType}`;
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
        ? this.tokenCipher.decrypt(accessTokenEncrypted, this.tokenContext(connection.oauthGrantId, "access"))
        : null,
      refreshToken: refreshTokenEncrypted
        ? this.tokenCipher.decrypt(refreshTokenEncrypted, this.tokenContext(connection.oauthGrantId, "refresh"))
        : null,
    };
  }

  async save(connection) {
    if (connection.provider !== this.provider) throw new Error("Connection provider does not match its store.");
    const row = await this.persistence.saveOAuthConnection({
      ...connection,
      accessTokenEncrypted: this.encryptToken(connection.oauthGrantId, "access", connection.accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.oauthGrantId, "refresh", connection.refreshToken),
    });
    return this.decryptConnection(row);
  }

  async getByConnectionId(connectionId) {
    return this.decryptConnection(await this.persistence.getOAuthConnectionById(connectionId, this.provider));
  }

  async updateTokens(connectionId, tokens) {
    const connection = await this.getByConnectionId(connectionId);
    if (!connection) return null;
    const row = await this.persistence.updateOAuthGrantTokens(connectionId, this.provider, {
      accessTokenEncrypted: this.encryptToken(connection.oauthGrantId, "access", tokens.accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.oauthGrantId, "refresh", tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    });
    return this.decryptConnection(row);
  }

  async deleteByConnectionId(connectionId) {
    await this.persistence.deleteOAuthConnection(connectionId, this.provider);
    return true;
  }

  async markReauthorizationRequired(connectionId) {
    return this.persistence.markOAuthGrantReauthorizationRequired(connectionId, this.provider);
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
