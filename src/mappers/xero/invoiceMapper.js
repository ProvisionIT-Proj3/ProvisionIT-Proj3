const { toMoney, toISODate, toUtcTimestamp, firstDefined } = require('../../canonical/utils');

/**
 * Map a Xero Invoice resource to the canonical Invoice shape.
 *
 * Xero-specific note (see Structural Differences tab): Xero uses the same
 * Invoice resource for both sales invoices (Type = ACCREC) and purchase
 * bills (Type = ACCPAY). Per the design implication in the Mapping
 * Register, only ACCREC records are mapped to the canonical Invoice entity
 * — ACCPAY records are out of scope for this PoC and return null.
 *
 * @param {object} xeroInvoice
 * @returns {object|null}
 */
function mapXeroInvoice(xeroInvoice) {
  if (!xeroInvoice) return null;
  if (xeroInvoice.Type !== 'ACCREC') return null; // purchase bill — not a sales invoice

  const lines = (xeroInvoice.LineItems || []).map((line) => ({
    description: line.Description,
    quantity: line.Quantity !== undefined ? Number(line.Quantity) : undefined,
    unitAmount: toMoney(line.UnitAmount),
    lineAmount: toMoney(line.LineAmount),
    accountCode: line.AccountCode,
    taxAmount: toMoney(line.TaxAmount),
  }));

  return {
    id: xeroInvoice.InvoiceID,
    sourceSystem: 'xero',
    invoiceNumber: xeroInvoice.InvoiceNumber,
    customerId: xeroInvoice.Contact?.ContactID,
    transactionDate: toISODate(xeroInvoice.Date),
    dueDate: toISODate(xeroInvoice.DueDate),
    lines,
    total: toMoney(xeroInvoice.Total),
    amountDue: toMoney(xeroInvoice.AmountDue),
    tax: toMoney(xeroInvoice.TotalTax),
    currency: xeroInvoice.CurrencyCode,
    exchangeRate: xeroInvoice.CurrencyRate !== undefined ? Number(xeroInvoice.CurrencyRate) : undefined,
    updatedAt: toUtcTimestamp(firstDefined(xeroInvoice.UpdatedDateUTC, xeroInvoice.UpdatedDateUTCString)),

    _vendorSpecific: {
      type: xeroInvoice.Type,
      amountPaid: toMoney(xeroInvoice.AmountPaid),
      amountCredited: toMoney(xeroInvoice.AmountCredited),
    },
  };
}

module.exports = { mapXeroInvoice };
