const DEFAULT_SCOPES = [
  "offline_access",
  "accounting.contacts.read",
  "accounting.invoices.read",
  "accounting.payments.read",
];

function getXeroConfig() {
  return {
    clientId: process.env.XERO_CLIENT_ID,
    clientSecret: process.env.XERO_CLIENT_SECRET,
    redirectUri: process.env.XERO_REDIRECT_URI,
    scopes: (process.env.XERO_SCOPES || DEFAULT_SCOPES.join(" "))
      .split(/\s+/)
      .filter(Boolean),
    authorizationUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    connectionsUrl: "https://api.xero.com/connections",
  };
}

function assertXeroConfigured(config) {
  const missing = [
    ["XERO_CLIENT_ID", config.clientId],
    ["XERO_CLIENT_SECRET", config.clientSecret],
    ["XERO_REDIRECT_URI", config.redirectUri],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    const err = new Error(`Xero OAuth is not configured. Missing: ${missing.join(", ")}.`);
    err.status = 503;
    err.code = "OAUTH_NOT_CONFIGURED";
    throw err;
  }

  try {
    const redirectUrl = new URL(config.redirectUri);
    if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") {
      const err = new Error("XERO_REDIRECT_URI must use HTTPS, except for localhost development.");
      err.status = 500;
      err.code = "INVALID_OAUTH_CONFIGURATION";
      throw err;
    }
  } catch (error) {
    if (error.code === "INVALID_OAUTH_CONFIGURATION") throw error;
    const err = new Error("XERO_REDIRECT_URI must be an absolute URL.");
    err.status = 500;
    err.code = "INVALID_OAUTH_CONFIGURATION";
    throw err;
  }
}

module.exports = { getXeroConfig, assertXeroConfigured };
