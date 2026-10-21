const xeroConnector = require("./xero");
const quickBooksConnector = require("./quickbooks");

// Each accounting provider exposes the same connector methods.
// This allows the service layer to work with different providers
// without needing to understand their individual API implementations.
const connectors = new Map([
  ["xero", xeroConnector],
  ["quickbooks", quickBooksConnector],
]);

function createConnector(provider) {
  const connector = connectors.get(provider);

  // Unsupported providers are rejected before any API requests are made.
  // A consistent error response helps callers identify invalid providers
  // without affecting the existing accounting connections.
  if (!connector) {
    const error = new Error(
      `Unsupported accounting provider: ${provider}`
    );

    error.status = 400;
    error.code = "UNSUPPORTED_PROVIDER";

    throw error;
  }

  return connector;
}

module.exports = { createConnector };
