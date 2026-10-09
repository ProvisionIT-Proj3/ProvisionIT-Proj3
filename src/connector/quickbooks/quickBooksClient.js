const { registry } = require("../../auth");

/**
 * Makes an authenticated request to the QuickBooks Accounting API.
 *
 * connectionId is the middleware-generated internal connection ID.
 * The QuickBooks auth service handles realmId, access tokens,
 * token refresh, headers, and the API base URL.
 */
async function quickBooksRequest(
  connectionId,
  relativePath,
  options = {}
) {
  const quickBooksAuth = registry.require("quickbooks");

  const response = await quickBooksAuth.request(
    connectionId,
    relativePath,
    options
  );

  if (!response.ok) {
    const error = new Error(
      `QuickBooks API request failed with status ${response.status}.`
    );

    error.status = response.status;
    error.code = "QUICKBOOKS_API_ERROR";

    throw error;
  }

  return response.json();
}

module.exports = { quickBooksRequest };
