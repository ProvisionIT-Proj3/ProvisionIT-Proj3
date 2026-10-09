const TokenCipher = require("./tokenCipher");

const REQUIRED_PERSISTENCE_METHODS = [
  "createOAuthCredential",
  "updateOAuthCredentialTokens",
  "saveOAuthConnection",
  "getOAuthConnectionById",
  "deleteOAuthConnection",
  "listOAuthConnections",
];

function toIsoString(value) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson(value) {
  if (!value) return null;
  return typeof value === "string" ? JSON.parse(value) : value;
}

function credentialIdFrom(row) {
  if (typeof row === "string") return row;
  return row?.credential_id ?? row?.credentialId ?? null;
}

function mapDatabaseRow(row) {
  if (!row) return null;
  return {
    connectionId: row.connection_id ?? row.connectionId,
    credentialId: credentialIdFrom(row),
    provider: row.platform ?? row.provider,
    externalConnectionId: row.external_connection_id ?? row.externalConnectionId,
    providerAccountId:
      row.external_account_id ?? row.externalAccountId ?? row.provider_account_id,
    accountName: row.company_name ?? row.companyName,
    metadata: parseJson(row.provider_metadata ?? row.providerMetadata) || {},
    status: row.credential_status ?? row.credentialStatus ?? row.status,
    createdAt: toIsoString(row.date_connected ?? row.createdAt),
    expiresAt: toIsoString(row.token_expires_at ?? row.expiresAt),
    accessTokenEncrypted: parseJson(row.access_token ?? row.accessToken),
    refreshTokenEncrypted: parseJson(row.refresh_token ?? row.refreshToken),
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

  tokenContext(credentialId, tokenType) {
    return `${this.provider}:${credentialId}:${tokenType}`;
  }

  encryptToken(credentialId, tokenType, token) {
    if (token === undefined || token === null) return null;
    return JSON.stringify(this.tokenCipher.encrypt(token, this.tokenContext(credentialId, tokenType)));
  }

  decryptConnection(row) {
    const stored = mapDatabaseRow(row);
    if (!stored) return null;
    const { accessTokenEncrypted, refreshTokenEncrypted, ...connection } = stored;
    return {
      ...connection,
      accessToken: accessTokenEncrypted
        ? this.tokenCipher.decrypt(
          accessTokenEncrypted,
          this.tokenContext(connection.credentialId, "access"),
        )
        : null,
      refreshToken: refreshTokenEncrypted
        ? this.tokenCipher.decrypt(
          refreshTokenEncrypted,
          this.tokenContext(connection.credentialId, "refresh"),
        )
        : null,
    };
  }

  async saveAuthorization(connections, tokens) {
    if (!connections.length) return [];
    if (connections.some((connection) => connection.provider !== this.provider)) {
      throw new Error("Connection provider does not match its store.");
    }

    const credential = await this.persistence.createOAuthCredential(this.provider);
    const credentialId = credentialIdFrom(credential);
    await this.persistence.updateOAuthCredentialTokens(credentialId, {
      accessTokenEncrypted: this.encryptToken(credentialId, "access", tokens.accessToken),
      refreshTokenEncrypted: this.encryptToken(credentialId, "refresh", tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      status: tokens.status || "active",
    });

    const rows = [];
    for (const connection of connections) {
      rows.push(await this.persistence.saveOAuthConnection(connection, credentialId));
    }
    return rows.map((row) => this.decryptConnection(row));
  }

  async save(connection) {
    const [saved] = await this.saveAuthorization([connection], {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
      status: connection.status,
    });
    return saved;
  }

  async getByConnectionId(connectionId) {
    const row = await this.persistence.getOAuthConnectionById(connectionId, this.provider);
    return this.decryptConnection(row);
  }

  async updateTokens(connectionId, tokens) {
    const connection = await this.getByConnectionId(connectionId);
    if (!connection) return null;
    await this.persistence.updateOAuthCredentialTokens(connection.credentialId, {
      accessTokenEncrypted: this.encryptToken(connection.credentialId, "access", tokens.accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.credentialId, "refresh", tokens.refreshToken),
      expiresAt: tokens.expiresAt,
      status: tokens.status || "active",
    });
    return this.getByConnectionId(connectionId);
  }

  async deleteByConnectionId(connectionId) {
    const result = await this.persistence.deleteOAuthConnection(connectionId, this.provider);
    return result?.deleted !== false;
  }

  async markReauthorizationRequired(connectionId) {
    const connection = await this.getByConnectionId(connectionId);
    if (!connection) return null;
    await this.persistence.updateOAuthCredentialTokens(connection.credentialId, {
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      expiresAt: null,
      status: "reauthorization_required",
    });
    return this.getByConnectionId(connectionId);
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
