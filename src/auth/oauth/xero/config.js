const DEFAULT_SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.transactions",
  "app.connections",
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
}

module.exports = { getXeroConfig, assertXeroConfigured };
