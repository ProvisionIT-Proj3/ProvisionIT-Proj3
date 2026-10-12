const { quickBooksRequest } = require("./quickBooksClient");

// Optional report parameters. Anything left out gets QBO's default: this
// fiscal year to date, on the company's preferred accounting basis.
const REPORT_PARAMS = {
  startDate: "start_date", // 'YYYY-MM-DD'
  endDate: "end_date", // 'YYYY-MM-DD'
  accountingMethod: "accounting_method", // 'Accrual' | 'Cash'
};

async function getTrialBalance(connectionId, options = {}) {
  const params = new URLSearchParams();
  for (const [option, param] of Object.entries(REPORT_PARAMS)) {
    if (options[option]) params.set(param, options[option]);
  }
  const query = params.toString();

  const data = await quickBooksRequest(
    connectionId,
    query ? `reports/TrialBalance?${query}` : "reports/TrialBalance"
  );

  return data;
}

module.exports = { getTrialBalance };
