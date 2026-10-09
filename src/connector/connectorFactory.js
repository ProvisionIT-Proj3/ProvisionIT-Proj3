const xeroConnector = require("./xero");
const quickBooksConnector = require("./quickbooks");

const connectors = new Map([
  ["xero", xeroConnector],
  ["quickbooks", quickBooksConnector],
]);

function createConnector(provider) {
  const connector = connectors.get(provider);

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
