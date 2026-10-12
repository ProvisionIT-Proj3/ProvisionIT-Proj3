const { xeroRequest } = require("./xeroClient");

// options.endDate ('YYYY-MM-DD') is the as-at date; Xero defaults to today.
async function getTrialBalance(connectionId, options = {}) {
  const path = options.endDate
    ? `Reports/TrialBalance?date=${encodeURIComponent(options.endDate)}`
    : "Reports/TrialBalance";

  const data = await xeroRequest(connectionId, path);

  return data.Reports?.[0] ?? null;
}

module.exports = { getTrialBalance };
