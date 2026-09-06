const { toMoney, toISODate, toUtcTimestamp, firstDefined } = require('../../canonical/utils');

/**
 * Map a Xero Payment resource to the canonical Payment shape.
 *
 * Xero represents both customer receipts and supplier payments through the
 * same Payment resource; direction is inferred from the linked Invoice's
 * Type (ACCREC = receivable, ACCPAY = payable) where available.
 *
 * @param {object} xeroPayment
 * @returns {object|null}
 */
function mapXeroPayment(xeroPayment) {
  if (!xeroPayment) return null;

  const invoiceType = xeroPayment.Invoice?.Type;
  const direction = invoiceType === 'ACCPAY' ? 'payable' : 'receivable';

  return {
    id: xeroPayment.PaymentID,
    sourceSystem: 'xero',
    direction,
    partyId: xeroPayment.Invoice?.Contact?.ContactID,
    date: toISODate(xeroPayment.Date),
    amount: toMoney(xeroPayment.Amount),
    invoiceAllocations: xeroPayment.Invoice
      ? [{ invoiceId: xeroPayment.Invoice.InvoiceID, amount: toMoney(xeroPayment.Amount) }]
      : [],
    accountId: xeroPayment.Account?.AccountID,
    reference: xeroPayment.Reference || undefined,
    paymentType: xeroPayment.PaymentType || undefined,
    updatedAt: toUtcTimestamp(firstDefined(xeroPayment.UpdatedDateUTC, xeroPayment.UpdatedDateUTCString)),

    _vendorSpecific: {
      bankAmount: toMoney(xeroPayment.BankAmount),
      isReconciled: xeroPayment.IsReconciled,
      batchPaymentId: xeroPayment.BatchPaymentID,
    },
  };
}

module.exports = { mapXeroPayment };
