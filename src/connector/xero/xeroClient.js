const { registry } = require("../../auth");

/**
 * Makes an authenticated request to the Xero Accounting API.
 *
 * connectionId is the middleware-generated internal connection ID.
 * Authentication handles the Xero tenant ID, access token,
 * token refresh, headers, and API base URL.
 */
async function xeroRequest(connectionId, relativePath, options = {}) {
  const xeroAuth = registry.require("xero");

  const response = await xeroAuth.request(
    connectionId,
    relativePath,
    options
  );

  if (!response.ok) {
    const error = new Error(
      `Xero API request failed with status ${response.status}.`
    );

    error.status = response.status;
    error.code = "XERO_API_ERROR";

    throw error;
  }

  return response.json();
}

module.exports = { xeroRequest };
