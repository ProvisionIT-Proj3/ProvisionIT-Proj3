const { toMoney, toISODate, toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a QuickBooks Online Payment resource to the canonical Payment shape.
 * The QuickBooks Payment entity focuses on customer receipts, so direction
 * is always 'receivable' for this PoC (supplier-side payments would come
 * from the BillPayment entity, out of scope here).
 *
 * @param {object} qboPayment
 * @returns {object|null}
 */
function mapQuickbooksPayment(qboPayment) {
  if (!qboPayment) return null;

  const allocations = (qboPayment.Line || []).map((line) => ({
    invoiceId: line.LinkedTxn?.[0]?.TxnId,
    amount: toMoney(line.Amount),
  }));

  return {
    id: qboPayment.Id,
    sourceSystem: 'quickbooks',
    direction: 'receivable',
    partyId: qboPayment.CustomerRef?.value,
    date: toISODate(qboPayment.TxnDate),
    amount: toMoney(qboPayment.TotalAmt),
    invoiceAllocations: allocations,
    accountId: qboPayment.DepositToAccountRef?.value,
    reference: qboPayment.PaymentRefNum || undefined,
    paymentType: qboPayment.PaymentMethodRef?.value || undefined,
    updatedAt: toUtcTimestamp(qboPayment.MetaData?.LastUpdatedTime),

    _vendorSpecific: {
      unappliedAmt: toMoney(qboPayment.UnappliedAmt),
    },
  };
}

module.exports = { mapQuickbooksPayment };
