const TokenCipher = require("./tokenCipher");

// Development-only in-memory implementation. Token values are encrypted at the
// storage boundary so the same encrypted shape can later be persisted in PostgreSQL.
class TestMemoryXeroConnectionStore {
  constructor({ tokenCipher } = {}) {
    this.connections = new Map();
    this.tokenCipher = tokenCipher || null;
  }

  getTokenCipher() {
    if (!this.tokenCipher) this.tokenCipher = TokenCipher.fromEnvironment();
    return this.tokenCipher;
  }

  tokenContext(connectionId, tokenType) {
    return `xero:${connectionId}:${tokenType}`;
  }

  encryptToken(connectionId, tokenType, token) {
    if (token === undefined || token === null) return null;
    return this.getTokenCipher().encrypt(token, this.tokenContext(connectionId, tokenType));
  }

  decryptConnection(storedConnection) {
    if (!storedConnection) return null;
    const {
      accessTokenEncrypted,
      refreshTokenEncrypted,
      ...connection
    } = storedConnection;

    return {
      ...connection,
      accessToken: accessTokenEncrypted
        ? this.getTokenCipher().decrypt(
          accessTokenEncrypted,
          this.tokenContext(connection.connectionId, "access"),
        )
        : null,
      refreshToken: refreshTokenEncrypted
        ? this.getTokenCipher().decrypt(
          refreshTokenEncrypted,
          this.tokenContext(connection.connectionId, "refresh"),
        )
        : null,
    };
  }

  async save(connection) {
    const { accessToken, refreshToken, ...metadata } = connection;
    const storedConnection = {
      ...metadata,
      accessTokenEncrypted: this.encryptToken(connection.connectionId, "access", accessToken),
      refreshTokenEncrypted: this.encryptToken(connection.connectionId, "refresh", refreshToken),
    };
    this.connections.set(connection.connectionId, storedConnection);
    return this.decryptConnection(storedConnection);
  }

  async getByConnectionId(connectionId) {
    return this.decryptConnection(this.connections.get(connectionId));
  }

  async updateTokens(connectionId, tokens) {
    const storedConnection = this.connections.get(connectionId);
    if (!storedConnection) return null;

    const { accessToken, refreshToken, ...metadata } = tokens;
    const updated = {
      ...storedConnection,
      ...metadata,
      ...(accessToken === undefined ? {} : {
        accessTokenEncrypted: this.encryptToken(connectionId, "access", accessToken),
      }),
      ...(refreshToken === undefined ? {} : {
        refreshTokenEncrypted: this.encryptToken(connectionId, "refresh", refreshToken),
      }),
    };
    this.connections.set(connectionId, updated);
    return this.decryptConnection(updated);
  }

  async deleteByConnectionId(connectionId) {
    return this.connections.delete(connectionId);
  }

  async markReauthorizationRequired(connectionId) {
    const storedConnection = this.connections.get(connectionId);
    if (!storedConnection) return null;
    const updated = {
      ...storedConnection,
      status: "reauthorization_required",
      expiresAt: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    };
    this.connections.set(connectionId, updated);
    return this.decryptConnection(updated);
  }

  async list() {
    return [...this.connections.values()].map(({
      accessTokenEncrypted,
      refreshTokenEncrypted,
      ...connection
    }) => connection);
  }
}

module.exports = TestMemoryXeroConnectionStore;
