const publicServerErrors = {
  AUTH_CONFIGURATION_ERROR: { status: 500, message: "Supabase authentication is not configured." },
  AUTHENTICATION_SERVICE_UNAVAILABLE: { status: 503, message: "The authentication service is unavailable." },
  AUTHORIZATION_SERVICE_UNAVAILABLE: { status: 503, message: "The user access profile could not be loaded." },
  CONNECTION_ACCESS_SERVICE_UNAVAILABLE: { status: 503, message: "Connection access is unavailable." },
  OAUTH_NOT_CONFIGURED: { status: 503, message: "OAuth is not configured." },
  INVALID_OAUTH_CONFIGURATION: { status: 500, message: "OAuth configuration is invalid." },
  INVALID_OAUTH_TOKEN_RESPONSE: { status: 502, message: "The provider returned an invalid token response." },
  XERO_TOKEN_EXCHANGE_FAILED: { status: 502, message: "Xero rejected the OAuth request." },
  XERO_CONNECTIONS_FAILED: { status: 502, message: "Xero connections could not be loaded." },
  XERO_DISCONNECT_FAILED: { status: 502, message: "Xero connection could not be disconnected." },
  QUICKBOOKS_TOKEN_EXCHANGE_FAILED: { status: 502, message: "QuickBooks rejected the OAuth request." },
  QUICKBOOKS_COMPANY_INFO_FAILED: { status: 502, message: "QuickBooks company information could not be loaded." },
  QUICKBOOKS_DISCONNECT_FAILED: { status: 502, message: "QuickBooks connection could not be revoked." },
};

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const requestedStatus = error.status;
  const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
    ? requestedStatus
    : 500;
  const isServerError = status >= 500;
  const publicError = Object.hasOwn(publicServerErrors, error.code)
    && publicServerErrors[error.code].status === status
    ? publicServerErrors[error.code]
    : null;
  // Raw exception messages can contain credentials or database query details.
  if (isServerError) console.error("API request failed.", { status });

  return res.status(status).json({
    error: {
      code: isServerError ? (publicError ? error.code : "SERVER_ERROR") : error.code || "INVALID_PARAMETER",
      message: isServerError ? publicError?.message || "Something went wrong." : error.message || "Request failed.",
    },
  });
}

module.exports = errorHandler;
