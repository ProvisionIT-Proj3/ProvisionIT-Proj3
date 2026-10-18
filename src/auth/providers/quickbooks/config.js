const { assertRedirectUri } = require("../../core/urlValidation");

const DEFAULT_SCOPES = ["com.intuit.quickbooks.accounting"];

function getQuickBooksConfig(env = process.env) {
  const environment = env.QUICKBOOKS_ENVIRONMENT || "sandbox";
  return {
    clientId: env.QUICKBOOKS_CLIENT_ID,
    clientSecret: env.QUICKBOOKS_CLIENT_SECRET,
    redirectUri: env.QUICKBOOKS_REDIRECT_URI,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    environment,
    scopes: (env.QUICKBOOKS_SCOPES || DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
    authorizationUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    revokeUrl: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    apiBaseUrl: environment === "production"
      ? "https://quickbooks.api.intuit.com/v3/company/"
      : "https://sandbox-quickbooks.api.intuit.com/v3/company/",
  };
}

function assertQuickBooksConfigured(config) {
  const missing = [
    ["QUICKBOOKS_CLIENT_ID", config.clientId],
    ["QUICKBOOKS_CLIENT_SECRET", config.clientSecret],
    ["QUICKBOOKS_REDIRECT_URI", config.redirectUri],
    ["TOKEN_ENCRYPTION_KEY", config.tokenEncryptionKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    const error = new Error(`QuickBooks OAuth is not configured. Missing: ${missing.join(", ")}.`);
    error.status = 503;
    error.code = "OAUTH_NOT_CONFIGURED";
    throw error;
  }
  if (!["sandbox", "production"].includes(config.environment)) {
    const error = new Error("QUICKBOOKS_ENVIRONMENT must be sandbox or production.");
    error.status = 500;
    error.code = "INVALID_OAUTH_CONFIGURATION";
    throw error;
  }
  assertRedirectUri(config.redirectUri, "QUICKBOOKS_REDIRECT_URI");
}

module.exports = { getQuickBooksConfig, assertQuickBooksConfigured };
