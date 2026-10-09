const { createHttpError } = require("./errors");
const crypto = require("node:crypto");

function toExpiresAt(expiresIn) {
  return new Date(Date.now() + Number(expiresIn || 0) * 1000).toISOString();
}

function toPublicConnection(connection) {
  const { accessToken, refreshToken, credentialId, oauthGrantId, ...publicConnection } = connection;
  return publicConnection;
}

class OAuthService {
  constructor({
    provider,
    stateStore,
    connectionStore,
    fetchImpl = global.fetch,
    refreshSkewMs = 60_000,
    idFactory = () => crypto.randomUUID(),
  }) {
    this.provider = provider;
    this.stateStore = stateStore;
    this.connectionStore = connectionStore;
    this.fetch = fetchImpl;
    this.refreshSkewMs = refreshSkewMs;
    this.idFactory = idFactory;
    this.refreshPromises = new Map();
  }

  getAuthorizationUrl(metadata = {}) {
    const state = this.stateStore.create({ ...metadata, provider: this.provider.id });
    return this.provider.getAuthorizationUrl(state);
  }

  async completeAuthorization(authorization) {
    const { code, state, error } = authorization;
    const stateRecord = state && this.stateStore.consume(state);
    if (!stateRecord || stateRecord.provider !== this.provider.id) {
      throw createHttpError("Invalid or expired OAuth state.", 400, "INVALID_OAUTH_STATE");
    }
    if (error) throw this.provider.authorizationDeniedError(error);
    if (!code) throw createHttpError("The provider did not return an authorization code.", 400, "MISSING_AUTHORIZATION_CODE");

    const tokens = await this.provider.exchangeAuthorizationCode(code, this.fetch);
    const accounts = await this.provider.discoverAccounts({
      authorization,
      tokens,
      fetchImpl: this.fetch,
    });
    if (!accounts.length) throw this.provider.noAccountsError();

    const connections = accounts.map((account) => ({
      ...account,
      connectionId: this.idFactory(),
      provider: this.provider.id,
    }));
    const saved = await this.connectionStore.saveAuthorization(connections, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: toExpiresAt(tokens.expires_in),
    });
    return saved.map(toPublicConnection);
  }

  async listConnections() {
    return (await this.connectionStore.list()).map(toPublicConnection);
  }

  async hasConnection(connectionId) {
    const connection = await this.connectionStore.getByConnectionId(connectionId);
    return Boolean(connection && connection.provider === this.provider.id);
  }

  async getAuthorizationHeaders(connectionId) {
    const connection = await this.getValidConnection(connectionId);
    return this.provider.getAuthorizationHeaders(connection);
  }

  async request(connectionId, path, options = {}) {
    const connection = await this.getValidConnection(connectionId);
    const url = this.provider.buildApiUrl(path, connection);
    return this.fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.headers || {}),
        ...this.provider.getAuthorizationHeaders(connection),
      },
    });
  }

  async disconnect(connectionId) {
    const connection = await this.getValidConnection(connectionId);
    await this.provider.disconnect(connection, this.fetch);
    await this.connectionStore.deleteByConnectionId(connectionId);
  }

  async getValidConnection(connectionId) {
    const connection = await this.connectionStore.getByConnectionId(connectionId);
    if (!connection) throw this.provider.connectionNotFoundError();
    if (connection.provider !== this.provider.id) throw this.provider.connectionNotFoundError();
    if (connection.status === "reauthorization_required") throw this.provider.reauthorizationRequiredError();
    if (new Date(connection.expiresAt).getTime() > Date.now() + this.refreshSkewMs) return connection;
    if (!connection.refreshToken) throw this.provider.reauthorizationRequiredError();

    const refreshKey = connection.credentialId || connection.connectionId;
    const existingRefresh = this.refreshPromises.get(refreshKey);
    if (existingRefresh) {
      await existingRefresh;
      return this.connectionStore.getByConnectionId(connectionId);
    }

    const refreshPromise = this.refreshConnection(connectionId, connection);
    this.refreshPromises.set(refreshKey, refreshPromise);
    try {
      return await refreshPromise;
    } finally {
      this.refreshPromises.delete(refreshKey);
    }
  }

  async refreshConnection(connectionId, connection) {
    try {
      const tokens = await this.provider.refreshTokens(connection.refreshToken, this.fetch);
      return this.connectionStore.updateTokens(connectionId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: toExpiresAt(tokens.expires_in),
      });
    } catch (error) {
      if (!this.provider.isReauthorizationError(error)) throw error;
      await this.connectionStore.markReauthorizationRequired(connectionId);
      throw this.provider.reauthorizationRequiredError();
    }
  }
}

module.exports = OAuthService;
