function createHttpError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function readResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError("Xero rejected the OAuth request.", 502, "XERO_OAUTH_FAILED");
  }
  return body;
}

class XeroOAuthService {
  constructor({ config, stateStore, connectionStore, fetchImpl = global.fetch }) {
    this.config = config;
    this.stateStore = stateStore;
    this.connectionStore = connectionStore;
    this.fetch = fetchImpl;
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
    if (!stateRecord) {
      throw createHttpError("Invalid or expired OAuth state.", 400, "INVALID_OAUTH_STATE");
    }
    if (error) {
      throw createHttpError("Xero authorization was not completed.", 400, "XERO_AUTHORIZATION_DENIED");
    }
    if (!code) {
      throw createHttpError("Xero did not return an authorization code.", 400, "MISSING_AUTHORIZATION_CODE");
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const tokenResponse = await this.fetch(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });
    const tokens = await readResponse(tokenResponse);

    const connectionsResponse = await this.fetch(this.config.connectionsUrl, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const tenants = await readResponse(connectionsResponse);
    if (!Array.isArray(tenants) || tenants.length === 0) {
      throw createHttpError("No Xero organisation was connected.", 400, "NO_XERO_TENANT");
    }

    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 0) * 1000).toISOString();
    const saved = tenants.map((tenant) => this.connectionStore.save({
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      tenantType: tenant.tenantType,
      createdAt: tenant.createdDateUtc,
      updatedAt: tenant.updatedDateUtc,
      expiresAt,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    }));
    return saved.map(({ accessToken, refreshToken, ...connection }) => connection);
  }

  listConnections() {
    return this.connectionStore.list();
  }
}

module.exports = XeroOAuthService;
