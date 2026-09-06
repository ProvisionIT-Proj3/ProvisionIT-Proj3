const { toMoney, toISODate, toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a MYOB Sale/Invoice resource to the canonical Invoice shape.
 *
 * @param {object} myobInvoice
 * @returns {object|null}
 */
function mapMyobInvoice(myobInvoice) {
  if (!myobInvoice) return null;

  const lines = (myobInvoice.Lines || []).map((line) => ({
    description: line.Description,
    quantity: line.ShipQuantity !== undefined ? Number(line.ShipQuantity) : undefined,
    unitAmount: toMoney(line.UnitPrice),
    lineAmount: toMoney(line.Total),
    accountCode: line.Account?.DisplayID,
    taxAmount: toMoney(line.TaxCode?.TaxAmount),
  }));

  return {
    id: myobInvoice.UID,
    sourceSystem: 'myob',
    invoiceNumber: myobInvoice.Number,
    customerId: myobInvoice.Customer?.UID,
    transactionDate: toISODate(myobInvoice.Date),
    dueDate: toISODate(myobInvoice.DueDate),
    lines,
    total: toMoney(myobInvoice.TotalAmount),
    amountDue: toMoney(myobInvoice.BalanceDueAmount),
    tax: toMoney(myobInvoice.TotalTax),
    currency: myobInvoice.ForeignCurrency?.CurrencyCode,
    exchangeRate: myobInvoice.ForeignCurrency?.CurrencyExchangeRate !== undefined
      ? Number(myobInvoice.ForeignCurrency.CurrencyExchangeRate)
      : undefined,
    updatedAt: toUtcTimestamp(myobInvoice.LastModified),

    _vendorSpecific: {
      rowVersion: myobInvoice.RowVersion,
      customerPurchaseOrderNumber: myobInvoice.CustomerPurchaseOrderNumber,
      freight: toMoney(myobInvoice.Freight),
      lastPaymentDate: toISODate(myobInvoice.LastPaymentDate),
    },
  };
}

module.exports = { mapMyobInvoice };
