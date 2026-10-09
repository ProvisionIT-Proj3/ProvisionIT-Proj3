const TokenCipher = require("./tokenCipher");
const crypto = require("node:crypto");

class TestMemoryConnectionStore {
  constructor({ provider, tokenCipher } = {}) {
    if (!provider) throw new Error("An OAuth provider id is required.");
    this.provider = provider;
    this.connections = new Map();
    this.credentials = new Map();
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
    const credential = this.credentials.get(stored.credentialId);
    if (!credential) return null;
    return {
      ...stored,
      status: credential.status,
      expiresAt: credential.expiresAt,
      accessToken: credential.accessTokenEncrypted
        ? this.getTokenCipher().decrypt(credential.accessTokenEncrypted, this.tokenContext(stored.credentialId, "access"))
        : null,
      refreshToken: credential.refreshTokenEncrypted
        ? this.getTokenCipher().decrypt(credential.refreshTokenEncrypted, this.tokenContext(stored.credentialId, "refresh"))
        : null,
    };
  }

  createCredential(tokens, credentialId = crypto.randomUUID()) {
    this.credentials.set(credentialId, {
      credentialId,
      provider: this.provider,
      status: tokens.status || "active",
      expiresAt: tokens.expiresAt,
      accessTokenEncrypted: this.encryptToken(credentialId, "access", tokens.accessToken),
      refreshTokenEncrypted: this.encryptToken(credentialId, "refresh", tokens.refreshToken),
    });
    return credentialId;
  }

  async saveAuthorization(connections, tokens) {
    if (!connections.length) return [];
    if (connections.some((connection) => connection.provider !== this.provider)) {
      throw new Error("Connection provider does not match its store.");
    }
    const credentialId = this.createCredential(tokens);
    return connections.map((connection) => {
      const { accessToken, refreshToken, oauthGrantId, ...metadata } = connection;
      const stored = { ...metadata, credentialId };
      this.connections.set(connection.connectionId, stored);
      return this.decryptConnection(stored);
    });
  }

  async save(connection) {
    if (connection.provider !== this.provider) throw new Error("Connection provider does not match its store.");
    const { accessToken, refreshToken, oauthGrantId, ...metadata } = connection;
    const credentialId = connection.credentialId || oauthGrantId || crypto.randomUUID();
    if (!this.credentials.has(credentialId)) {
      this.createCredential({
        accessToken,
        refreshToken,
        expiresAt: connection.expiresAt,
        status: connection.status,
      }, credentialId);
    }
    const stored = {
      ...metadata,
      credentialId,
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
    const credential = this.credentials.get(stored.credentialId);
    if (!credential) return null;
    const { accessToken, refreshToken, ...metadata } = tokens;
    this.credentials.set(stored.credentialId, {
      ...credential,
      ...metadata,
      status: tokens.status || "active",
      ...(accessToken === undefined ? {} : {
        accessTokenEncrypted: this.encryptToken(stored.credentialId, "access", accessToken),
      }),
      ...(refreshToken === undefined ? {} : {
        refreshTokenEncrypted: this.encryptToken(stored.credentialId, "refresh", refreshToken),
      }),
    });
    return this.decryptConnection(stored);
  }

  async deleteByConnectionId(connectionId) {
    const stored = this.connections.get(connectionId);
    if (!stored) return false;
    this.connections.delete(connectionId);
    const stillLinked = [...this.connections.values()]
      .some((connection) => connection.credentialId === stored.credentialId);
    if (!stillLinked) this.credentials.delete(stored.credentialId);
    return true;
  }

  async markReauthorizationRequired(connectionId) {
    const stored = this.connections.get(connectionId);
    if (!stored) return null;
    const credential = this.credentials.get(stored.credentialId);
    if (!credential) return null;
    this.credentials.set(stored.credentialId, {
      ...credential,
      status: "reauthorization_required",
      expiresAt: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
    });
    return this.decryptConnection(stored);
  }

  async list() {
    return [...this.connections.values()].map((connection) => {
      const credential = this.credentials.get(connection.credentialId);
      return {
        ...connection,
        status: credential?.status,
        expiresAt: credential?.expiresAt,
      };
    });
  }
}

module.exports = TestMemoryConnectionStore;
