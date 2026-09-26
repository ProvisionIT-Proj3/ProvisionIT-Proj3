const TokenCipher = require("./tokenCipher");

class TestMemoryConnectionStore {
  constructor({ provider, tokenCipher } = {}) {
    if (!provider) throw new Error("An OAuth provider id is required.");
    this.provider = provider;
    this.connections = new Map();
    this.tokenCipher = tokenCipher || null;
  }

  getTokenCipher() {
    if (!this.tokenCipher) this.tokenCipher = TokenCipher.fromEnvironment();
    return this.tokenCipher;
  }

  tokenContext(credentialContextId, tokenType) {
    return `${this.provider}:${credentialContextId}:${tokenType}`;
  }

  encryptToken(connectionId, tokenType, token) {
    if (token === undefined || token === null) return null;
    return this.getTokenCipher().encrypt(token, this.tokenContext(connectionId, tokenType));
  }

  decryptConnection(stored) {
    if (!stored) return null;
    const { accessTokenEncrypted, refreshTokenEncrypted, ...connection } = stored;
    return {
      ...connection,
      accessToken: accessTokenEncrypted
        ? this.getTokenCipher().decrypt(accessTokenEncrypted, this.tokenContext(connection.oauthGrantId, "access"))
        : null,
      refreshToken: refreshTokenEncrypted
        ? this.getTokenCipher().decrypt(refreshTokenEncrypted, this.tokenContext(connection.oauthGrantId, "refresh"))
        : null,
    };
  }

  async save(connection) {
    if (connection.provider !== this.provider) throw new Error("Connection provider does not match its store.");
    const { accessToken, refreshToken, ...metadata } = connection;
    const stored = {
      ...metadata,
      accessTokenEncrypted: this.encryptToken(connection.oauthGrantId, "access", accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.oauthGrantId, "refresh", refreshToken),
    };
    this.connections.set(connection.connectionId, stored);
    return this.decryptConnection(stored);
  }

  async getByConnectionId(connectionId) {
    return this.decryptConnection(this.connections.get(connectionId));
  }

  async updateTokens(connectionId, tokens) {
    const stored = this.connections.get(connectionId);
    if (!stored) return null;
    const { accessToken, refreshToken, ...metadata } = tokens;
    let requestedConnection;
    for (const [id, connection] of this.connections) {
      if (connection.oauthGrantId !== stored.oauthGrantId) continue;
      const updated = {
        ...connection,
        ...metadata,
        ...(accessToken === undefined ? {} : {
          accessTokenEncrypted: this.encryptToken(stored.oauthGrantId, "access", accessToken),
        }),
        ...(refreshToken === undefined ? {} : {
          refreshTokenEncrypted: this.encryptToken(stored.oauthGrantId, "refresh", refreshToken),
        }),
      };
      this.connections.set(id, updated);
      if (id === connectionId) requestedConnection = updated;
    }
    return this.decryptConnection(requestedConnection);
  }

  async deleteByConnectionId(connectionId) {
    return this.connections.delete(connectionId);
  }

  async markReauthorizationRequired(connectionId) {
    const stored = this.connections.get(connectionId);
    if (!stored) return null;
    let requestedConnection;
    for (const [id, connection] of this.connections) {
      if (connection.oauthGrantId !== stored.oauthGrantId) continue;
      const updated = {
        ...connection,
        status: "reauthorization_required",
        expiresAt: null,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      };
      this.connections.set(id, updated);
      if (id === connectionId) requestedConnection = updated;
    }
    return this.decryptConnection(requestedConnection);
  }

  async list() {
    return [...this.connections.values()].map(({ accessTokenEncrypted, refreshTokenEncrypted, ...connection }) => connection);
  }
}

module.exports = TestMemoryConnectionStore;
