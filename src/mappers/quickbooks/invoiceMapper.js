const { toMoney, toISODate, toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a QuickBooks Online Invoice resource to the canonical Invoice shape.
 * QuickBooks nests tax detail in TxnTaxDetail rather than exposing a single
 * total tax field directly, so it's flattened here to TotalTax.
 *
 * @param {object} qboInvoice
 * @returns {object|null}
 */
function mapQuickbooksInvoice(qboInvoice) {
  if (!qboInvoice) return null;

  const lines = (qboInvoice.Line || [])
    .filter((line) => line.DetailType === 'SalesItemLineDetail')
    .map((line) => ({
      description: line.Description,
      quantity: line.SalesItemLineDetail?.Qty,
      unitAmount: toMoney(line.SalesItemLineDetail?.UnitPrice),
      lineAmount: toMoney(line.Amount),
      accountCode: line.SalesItemLineDetail?.ItemRef?.value,
      taxAmount: undefined, // QuickBooks reports tax at the invoice level via TxnTaxDetail
    }));

  return {
    id: qboInvoice.Id,
    sourceSystem: 'quickbooks',
    invoiceNumber: qboInvoice.DocNumber,
    customerId: qboInvoice.CustomerRef?.value,
    transactionDate: toISODate(qboInvoice.TxnDate),
    dueDate: toISODate(qboInvoice.DueDate),
    lines,
    total: toMoney(qboInvoice.TotalAmt),
    amountDue: toMoney(qboInvoice.Balance),
    tax: toMoney(qboInvoice.TxnTaxDetail?.TotalTax),
    currency: qboInvoice.CurrencyRef?.value,
    exchangeRate: qboInvoice.ExchangeRate !== undefined ? Number(qboInvoice.ExchangeRate) : undefined,
    updatedAt: toUtcTimestamp(qboInvoice.MetaData?.LastUpdatedTime),

    _vendorSpecific: {
      billAddr: qboInvoice.BillAddr,
      shipAddr: qboInvoice.ShipAddr,
      linkedTxn: qboInvoice.LinkedTxn,
    },
  };
}

module.exports = { mapQuickbooksInvoice };
