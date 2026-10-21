const { quickBooksRequest } = require("./quickBooksClient");

// QuickBooks tax code identifiers vary between companies.
// The mapper uses this response to resolve account tax code references
// into meaningful tax code names.
// This query requests up to 1000 tax codes and does not paginate.
async function getTaxCodes(connectionId) {
  const query = encodeURIComponent("select * from TaxCode MAXRESULTS 1000");

  const data = await quickBooksRequest(
    connectionId,
    `query?query=${query}`
  );

  return data.QueryResponse?.TaxCode ?? [];
}

module.exports = { getTaxCodes };
