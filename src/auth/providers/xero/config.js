const DEFAULT_SCOPES = [
  "offline_access",
  "accounting.settings.read",
  "accounting.reports.trialbalance.read",
];

function getXeroConfig(env = process.env) {
  return {
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUri: env.XERO_REDIRECT_URI,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    scopes: (env.XERO_SCOPES || DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    authorizationUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    connectionsUrl: "https://api.xero.com/connections",
    apiBaseUrl: "https://api.xero.com/api.xro/2.0/",
  };
}

function assertXeroConfigured(config) {
  const missing = [
    ["XERO_CLIENT_ID", config.clientId],
    ["XERO_CLIENT_SECRET", config.clientSecret],
    ["XERO_REDIRECT_URI", config.redirectUri],
    ["TOKEN_ENCRYPTION_KEY", config.tokenEncryptionKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    const error = new Error(`Xero OAuth is not configured. Missing: ${missing.join(", ")}.`);
    error.status = 503;
    error.code = "OAUTH_NOT_CONFIGURED";
    throw error;
  }

  try {
    const redirectUrl = new URL(config.redirectUri);
    if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") {
      const error = new Error("XERO_REDIRECT_URI must use HTTPS, except for localhost development.");
      error.status = 500;
      error.code = "INVALID_OAUTH_CONFIGURATION";
      throw error;
    }
  } catch (error) {
    if (error.code === "INVALID_OAUTH_CONFIGURATION") throw error;
    const invalid = new Error("XERO_REDIRECT_URI must be an absolute URL.");
    invalid.status = 500;
    invalid.code = "INVALID_OAUTH_CONFIGURATION";
    throw invalid;
  }
}

module.exports = { getXeroConfig, assertXeroConfigured };
