function createHttpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readResponse(response, code = "XERO_OAUTH_FAILED") {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {

    throw createHttpError(
      "Xero rejected the OAuth request.",
      502,
      code
    );
  }

  return body;
}

function toExpiresAt(expiresIn) {
  return new Date(Date.now() + Number(expiresIn || 0) * 1000).toISOString();
}

function toPublicConnection(connection) {
  const { accessToken, refreshToken, ...publicConnection } = connection;
  return publicConnection;
}

class XeroOAuthService {
  constructor({ config, stateStore, connectionStore, fetchImpl = global.fetch, refreshSkewMs = 60_000 }) {
    this.config = config;
    this.stateStore = stateStore;
    this.connectionStore = connectionStore;
    this.fetch = fetchImpl;
    this.refreshSkewMs = refreshSkewMs;
  }

  getAuthorizationUrl() {
    const state = this.stateStore.create();
    const url = new URL(this.config.authorizationUrl);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(" "),
      state,
    }).toString();
    return url.toString();
  }

  async completeAuthorization({ code, state, error }) {
    const stateRecord = state && this.stateStore.consume(state);
    if (!stateRecord) throw createHttpError("Invalid or expired OAuth state.", 400, "INVALID_OAUTH_STATE");
    if (error) throw createHttpError("Xero authorization was not completed.", 400, "XERO_AUTHORIZATION_DENIED");
    if (!code) throw createHttpError("Xero did not return an authorization code.", 400, "MISSING_AUTHORIZATION_CODE");

    const tokens = await this.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    });
    const connectionsResponse = await this.fetch(this.config.connectionsUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const tenants = await readResponse(connectionsResponse, "XERO_CONNECTIONS_FAILED");
    if (!Array.isArray(tenants) || tenants.length === 0) {
      throw createHttpError("No Xero organisation was connected.", 400, "NO_XERO_TENANT");
    }

    const saved = await Promise.all(tenants.map((tenant) => this.connectionStore.save({
      // The Xero connection id maps to canonical Company.connectionId.
      connectionId: tenant.id || tenant.tenantId,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      tenantType: tenant.tenantType,
      createdAt: tenant.createdDateUtc,
      updatedAt: tenant.updatedDateUtc,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: toExpiresAt(tokens.expires_in),
    })));
    return saved.map(toPublicConnection);
  }

  async listConnections() {
    return this.connectionStore.list();
  }

  async getAuthorizationHeaders(connectionId) {
    const connection = await this.getValidConnection(connectionId);
    return {
      Authorization: `Bearer ${connection.accessToken}`,
      "xero-tenant-id": connection.tenantId,
    };
  }

  // Connector-only helper. Tokens are deliberately never returned via HTTP routes.
  async request(connectionId, url, options = {}) {
    const headers = await this.getAuthorizationHeaders(connectionId);
    return this.fetch(url, {
      ...options,
      headers: { Accept: "application/json", ...headers, ...(options.headers || {}) },
    });
  }

  async disconnect(connectionId) {
    const connection = await this.connectionStore.getByConnectionId(connectionId);
    if (!connection) throw createHttpError("Xero connection was not found.", 404, "XERO_CONNECTION_NOT_FOUND");

    const response = await this.fetch(`${this.config.connectionsUrl}/${encodeURIComponent(connectionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    });
    if (!response.ok) throw createHttpError("Xero connection could not be disconnected.", 502, "XERO_DISCONNECT_FAILED");
    await this.connectionStore.deleteByConnectionId(connectionId);
  }

  async getValidConnection(connectionId) {
    const connection = await this.connectionStore.getByConnectionId(connectionId);
    if (!connection) throw createHttpError("Xero connection was not found.", 404, "XERO_CONNECTION_NOT_FOUND");
    if (new Date(connection.expiresAt).getTime() > Date.now() + this.refreshSkewMs) return connection;
    if (!connection.refreshToken) {
      throw createHttpError("Xero connection needs to be authorised again.", 401, "XERO_REAUTHORIZATION_REQUIRED");
    }

    const tokens = await this.exchangeToken({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    });
    return this.connectionStore.updateTokens(connectionId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: toExpiresAt(tokens.expires_in),
    });
  }

  async exchangeToken(parameters) {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const tokenResponse = await this.fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
    });
    return readResponse(tokenResponse, "XERO_TOKEN_EXCHANGE_FAILED");
  }
}

module.exports = XeroOAuthService;
