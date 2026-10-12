const { quickBooksRequest } = require("./quickBooksClient");

// TaxCode ids differ per QBO company, so the mapper resolves an Account's
// TaxCodeRef to a name through this list. A company has a handful of tax
// codes, well under one page.
async function getTaxCodes(connectionId) {
  const query = encodeURIComponent("select * from TaxCode MAXRESULTS 1000");

  const data = await quickBooksRequest(
    connectionId,
    `query?query=${query}`
  );

  return data.QueryResponse?.TaxCode ?? [];
}

module.exports = { getTaxCodes };
