const { quickBooksRequest } = require("./quickBooksClient");

async function getTrialBalance(connectionId) {
  const data = await quickBooksRequest(
    connectionId,
    "reports/TrialBalance"
  );

  return data;
}

module.exports = { getTrialBalance };
