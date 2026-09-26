const { createHttpError } = require("../../core/errors");

async function readJson(response, code, message) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError(message, 502, code, {
      oauthError: typeof body.error === "string" ? body.error : null,
    });
  }
  return body;
}

class QuickBooksProvider {
  constructor(config) {
    this.id = "quickbooks";
    this.config = config;
  }

  basicAuthorization() {
    return `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64")}`;
  }

  getAuthorizationUrl(state) {
    const url = new URL(this.config.authorizationUrl);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      scope: this.config.scopes.join(" "),
      redirect_uri: this.config.redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  async exchangeToken(parameters, fetchImpl) {
    const response = await fetchImpl(this.config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: this.basicAuthorization(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
    });
    return readJson(response, "QUICKBOOKS_TOKEN_EXCHANGE_FAILED", "QuickBooks rejected the OAuth request.");
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

  async discoverAccounts({ authorization, tokens, fetchImpl }) {
    const realmId = typeof authorization.realmId === "string" ? authorization.realmId.trim() : "";
    if (!realmId) return [];
    const connection = { providerAccountId: realmId };
    const response = await fetchImpl(this.buildApiUrl(`companyinfo/${encodeURIComponent(realmId)}`, connection), {
      headers: {
        Accept: "application/json",
        ...this.getAuthorizationHeaders({ accessToken: tokens.access_token }),
      },
    });
    const body = await readJson(
      response,
      "QUICKBOOKS_COMPANY_INFO_FAILED",
      "QuickBooks company information could not be loaded.",
    );
    const companyInfo = body.CompanyInfo || {};
    return [{
      externalConnectionId: null,
      providerAccountId: realmId,
      accountName: companyInfo.CompanyName || companyInfo.LegalName || `QuickBooks ${realmId}`,
      metadata: { environment: this.config.environment },
      status: "active",
    }];
  }

  getAuthorizationHeaders(connection) {
    return { Authorization: `Bearer ${connection.accessToken}` };
  }

  buildApiUrl(path, connection) {
    if (
      typeof path !== "string"
      || !path
      || /^[a-z][a-z\d+.-]*:/i.test(path)
      || path.startsWith("//")
      || /(^|\/)\.\.(\/|$)/.test(path)
    ) {
      throw createHttpError("QuickBooks API requests require a relative path.", 400, "INVALID_QUICKBOOKS_API_PATH");
    }
    if (!connection?.providerAccountId) {
      throw createHttpError("QuickBooks connection has no realm ID.", 500, "QUICKBOOKS_REALM_ID_MISSING");
    }
    const companyBase = new URL(`${encodeURIComponent(connection.providerAccountId)}/`, this.config.apiBaseUrl);
    return new URL(path.replace(/^\/+/, ""), companyBase).toString();
  }

  async disconnect(connection, fetchImpl) {
    const response = await fetchImpl(this.config.revokeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: this.basicAuthorization(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: connection.refreshToken || connection.accessToken }),
    });
    if (!response.ok) {
      throw createHttpError("QuickBooks connection could not be revoked.", 502, "QUICKBOOKS_DISCONNECT_FAILED");
    }
  }

  authorizationDeniedError() {
    return createHttpError("QuickBooks authorization was not completed.", 400, "QUICKBOOKS_AUTHORIZATION_DENIED");
  }

  noAccountsError() {
    return createHttpError("QuickBooks did not return a company realm.", 400, "NO_QUICKBOOKS_REALM");
  }

  connectionNotFoundError() {
    return createHttpError("QuickBooks connection was not found.", 404, "QUICKBOOKS_CONNECTION_NOT_FOUND");
  }

  reauthorizationRequiredError() {
    return createHttpError("QuickBooks connection needs to be authorised again.", 401, "QUICKBOOKS_REAUTHORIZATION_REQUIRED");
  }

  isReauthorizationError(error) {
    return error.code === "QUICKBOOKS_TOKEN_EXCHANGE_FAILED"
      && ["invalid_grant", "invalid_token"].includes(error.oauthError);
  }
}

module.exports = QuickBooksProvider;
