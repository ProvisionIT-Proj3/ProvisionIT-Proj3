const { toMoney, toISODate, toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a MYOB CustomerPayment resource to the canonical Payment shape
 * (direction = 'receivable').
 * @param {object} myobCustomerPayment
 * @returns {object|null}
 */
function mapMyobCustomerPayment(myobCustomerPayment) {
  if (!myobCustomerPayment) return null;
  return mapCommon(myobCustomerPayment, 'receivable', myobCustomerPayment.Customer?.UID);
}

/**
 * Map a MYOB SupplierPayment resource to the canonical Payment shape
 * (direction = 'payable').
 * @param {object} myobSupplierPayment
 * @returns {object|null}
 */
function mapMyobSupplierPayment(myobSupplierPayment) {
  if (!myobSupplierPayment) return null;
  return mapCommon(myobSupplierPayment, 'payable', myobSupplierPayment.Supplier?.UID);
}

function mapCommon(myobPayment, direction, partyId) {
  const allocations = (myobPayment.Lines || myobPayment.Invoices || []).map((alloc) => ({
    invoiceId: alloc.Invoice?.UID || alloc.UID,
    amount: toMoney(alloc.Amount),
  }));

  return {
    id: myobPayment.UID,
    sourceSystem: 'myob',
    direction,
    partyId,
    date: toISODate(myobPayment.Date),
    amount: toMoney(myobPayment.AmountPaid ?? myobPayment.Amount),
    invoiceAllocations: allocations,
    accountId: myobPayment.Account?.UID,
    reference: myobPayment.Memo || myobPayment.PaymentNumber || undefined,
    paymentType: myobPayment.PaymentMethod || undefined,
    updatedAt: toUtcTimestamp(myobPayment.LastModified),

    _vendorSpecific: {
      rowVersion: myobPayment.RowVersion,
    },
  };
}

module.exports = { mapMyobCustomerPayment, mapMyobSupplierPayment };
