const { registry } = require("../auth");
const { createConnector } = require("../connector/connectorFactory");

async function getConnector(connectionId) {
  const provider = await registry.resolveProvider(connectionId);

  if (!provider) {
    const error = new Error("Accounting connection not found.");
    error.status = 404;
    error.code = "CONNECTION_NOT_FOUND";
    throw error;
  }

  return createConnector(provider);
}

async function getAccounts(connectionId) {
  const connector = await getConnector(connectionId);

  const accounts = await connector.getAccounts(connectionId);

  return {
    data: accounts,
    pagination: {
      page: 1,
      pageSize: accounts.length,
      totalItems: accounts.length,
    },
  };
}

async function getTrialBalance(connectionId) {
  const connector = await getConnector(connectionId);

  const trialBalance = await connector.getTrialBalance(connectionId);

  return {
    data: trialBalance,
  };
}

module.exports = {
  getAccounts,
  getTrialBalance,
};
