const { xeroRequest } = require("./xeroClient");

async function getTrialBalance(connectionId) {
  const data = await xeroRequest(
    connectionId,
    "Reports/TrialBalance"
  );

  return data.Reports?.[0] ?? null;
}

module.exports = { getTrialBalance };
