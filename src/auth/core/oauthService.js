const { createHttpError } = require("./errors");
const crypto = require("node:crypto");

function toStoredTokens(tokens, previousRefreshToken) {
  const expiresIn = tokens?.expires_in;
  const seconds = typeof expiresIn === "number" || typeof expiresIn === "string"
    ? Number(expiresIn)
    : NaN;
  const expiresAt = Date.now() + seconds * 1000;
  if (typeof tokens?.access_token !== "string" || !tokens.access_token.trim()
    || !Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(expiresAt)
    || expiresAt > 8.64e15) {
    throw createHttpError("The provider returned an invalid token response.", 502, "INVALID_OAUTH_TOKEN_RESPONSE");
  }
  const refreshToken = tokens.refresh_token ?? previousRefreshToken;
  if (refreshToken !== undefined && refreshToken !== null
    && (typeof refreshToken !== "string" || !refreshToken.trim())) {
    throw createHttpError("The provider returned an invalid token response.", 502, "INVALID_OAUTH_TOKEN_RESPONSE");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: new Date(expiresAt).toISOString(),
  };
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
    auditLogger = null,
  }) {
    this.provider = provider;
    this.stateStore = stateStore;
    this.connectionStore = connectionStore;
    this.fetch = fetchImpl;
    this.refreshSkewMs = refreshSkewMs;
    this.idFactory = idFactory;
    this.auditLogger = auditLogger;
    this.refreshPromises = new Map();
  }

  async recordAudit(event) {
    if (!this.auditLogger) return;
    try {
      await this.auditLogger.record({ provider: this.provider.id, ...event });
    } catch {
      // Audit failures must not expose database details or break the OAuth flow.
    }
  }

  getAuthorizationUrl(metadata = {}) {
    const state = this.stateStore.create({ ...metadata, provider: this.provider.id });
    return this.provider.getAuthorizationUrl(state);
  }

  async completeAuthorization(authorization) {
    const { code, state, error } = authorization;
    let stateRecord = null;
    try {
      stateRecord = state && this.stateStore.consume(state);
      if (!stateRecord || stateRecord.provider !== this.provider.id) {
        throw createHttpError("Invalid or expired OAuth state.", 400, "INVALID_OAUTH_STATE");
      }
      if (error) throw this.provider.authorizationDeniedError(error);
      if (typeof code !== "string" || !code.trim()) {
        throw createHttpError("The provider did not return an authorization code.", 400, "MISSING_AUTHORIZATION_CODE");
      }

      const tokens = await this.provider.exchangeAuthorizationCode(code, this.fetch);
      const storedTokens = toStoredTokens(tokens);
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
      const saved = await this.connectionStore.saveAuthorization(connections, storedTokens);
      await this.recordAudit({
        actorUserId: stateRecord.actorUserId,
        action: "oauth.completed",
        outcome: "success",
        metadata: { connectionCount: saved.length },
      });
      for (const connection of saved) {
        await this.recordAudit({
          actorUserId: stateRecord.actorUserId,
          connectionId: connection.connectionId,
          action: "connection.created",
          outcome: "success",
        });
      }
      return saved.map(toPublicConnection);
    } catch (authorizationError) {
      await this.recordAudit({
        actorUserId: stateRecord?.actorUserId,
        action: "oauth.failed",
        outcome: "failure",
        errorCode: authorizationError.code || "OAUTH_AUTHORIZATION_FAILED",
      });
      throw authorizationError;
    }
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

  async disconnect(connectionId, { actorUserId } = {}) {
    try {
      const stored = await this.connectionStore.getByConnectionId(connectionId);
      if (!stored || stored.provider !== this.provider.id) throw this.provider.connectionNotFoundError();
      // Unusable credentials must not prevent an admin from removing a local connection.
      if (stored.status !== "reauthorization_required") {
        let connection = null;
        try {
          connection = await this.getValidConnection(connectionId);
        } catch (error) {
          const reauthorizationError = this.provider.reauthorizationRequiredError();
          if (error.status !== reauthorizationError.status || error.code !== reauthorizationError.code) {
            throw error;
          }
        }
        if (connection) await this.provider.disconnect(connection, this.fetch);
      }
      await this.connectionStore.deleteByConnectionId(connectionId);
      await this.recordAudit({
        actorUserId,
        connectionId,
        action: "connection.disconnected",
        outcome: "success",
      });
    } catch (disconnectError) {
      await this.recordAudit({
        actorUserId,
        connectionId,
        action: "connection.disconnected",
        outcome: "failure",
        errorCode: disconnectError.code || "CONNECTION_DISCONNECT_FAILED",
      });
      throw disconnectError;
    }
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
      // Providers may omit refresh_token when the existing token remains valid.
      const updated = await this.connectionStore.updateTokens(
        connectionId, toStoredTokens(tokens, connection.refreshToken),
      );
      if (!updated) throw this.provider.connectionNotFoundError();
      await this.recordAudit({
        connectionId,
        action: "token.refreshed",
        outcome: "success",
      });
      return updated;
    } catch (error) {
      if (!this.provider.isReauthorizationError(error)) {
        await this.recordAudit({
          connectionId,
          action: "token.refreshed",
          outcome: "failure",
          errorCode: error.code || "TOKEN_REFRESH_FAILED",
        });
        throw error;
      }
      await this.connectionStore.markReauthorizationRequired(connectionId);
      await this.recordAudit({
        connectionId,
        action: "connection.reauthorization_required",
        outcome: "success",
        errorCode: error.code || "TOKEN_REFRESH_REJECTED",
      });
      throw this.provider.reauthorizationRequiredError();
    }
  }
}

module.exports = OAuthService;
