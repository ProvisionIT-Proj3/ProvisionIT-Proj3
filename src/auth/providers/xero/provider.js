const { createHttpError } = require("../../core/errors");

async function readResponse(response, code, message) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(message, 502, code, {
      oauthError: typeof body.error === "string" ? body.error : null,
    });
  }
  return body;
}

class XeroProvider {
  constructor(config) {
    this.id = "xero";
    this.config = config;
  }

  getAuthorizationUrl(state) {
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

  async exchangeToken(parameters, fetchImpl) {
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
    });
    return readResponse(response, "XERO_TOKEN_EXCHANGE_FAILED", "Xero rejected the OAuth request.");
  }

  exchangeAuthorizationCode(code, fetchImpl) {
    return this.exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    }, fetchImpl);
  }

  refreshTokens(refreshToken, fetchImpl) {
    return this.exchangeToken({ grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl);
  }

  async discoverAccounts(accessToken, fetchImpl) {
    const response = await fetchImpl(this.config.connectionsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const tenants = await readResponse(response, "XERO_CONNECTIONS_FAILED", "Xero rejected the connections request.");
    if (!Array.isArray(tenants)) return [];
    return tenants.map((tenant) => ({
      connectionId: tenant.id || tenant.tenantId,
      providerAccountId: tenant.tenantId,
      accountName: tenant.tenantName,
      metadata: { tenantType: tenant.tenantType },
      createdAt: tenant.createdDateUtc,
      updatedAt: tenant.updatedDateUtc,
      status: "active",
    }));
  }

  getAuthorizationHeaders(connection) {
    return {
      Authorization: `Bearer ${connection.accessToken}`,
      "xero-tenant-id": connection.providerAccountId,
    };
  }

  buildApiUrl(path) {
    if (typeof path !== "string" || !path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith("//")) {
      throw createHttpError("Xero API requests require a relative path.", 400, "INVALID_XERO_API_PATH");
    }
    return new URL(path.replace(/^\/+/, ""), this.config.apiBaseUrl).toString();
  }

  async disconnect(connection, fetchImpl) {
    const response = await fetchImpl(`${this.config.connectionsUrl}/${encodeURIComponent(connection.connectionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${connection.accessToken}` },
    });
    if (!response.ok) throw createHttpError("Xero connection could not be disconnected.", 502, "XERO_DISCONNECT_FAILED");
  }

  authorizationDeniedError() {
    return createHttpError("Xero authorization was not completed.", 400, "XERO_AUTHORIZATION_DENIED");
  }

  noAccountsError() {
    return createHttpError("No Xero organisation was connected.", 400, "NO_XERO_TENANT");
  }

  connectionNotFoundError() {
    return createHttpError("Xero connection was not found.", 404, "XERO_CONNECTION_NOT_FOUND");
  }

  reauthorizationRequiredError() {
    return createHttpError("Xero connection needs to be authorised again.", 401, "XERO_REAUTHORIZATION_REQUIRED");
  }

  isReauthorizationError(error) {
    return error.code === "XERO_TOKEN_EXCHANGE_FAILED"
      && ["invalid_grant", "invalid_token"].includes(error.oauthError);
  }
}

module.exports = XeroProvider;
