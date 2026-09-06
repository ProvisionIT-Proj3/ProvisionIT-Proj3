const { toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a MYOB Contact/Customer resource to the canonical Customer shape.
 * MYOB models customers as a distinct resource (unlike Xero's shared
 * Contact), so no role filtering is needed here.
 *
 * @param {object} myobCustomer
 * @returns {object|null}
 */
function mapMyobCustomer(myobCustomer) {
  if (!myobCustomer) return null;

  return {
    id: myobCustomer.UID,
    sourceSystem: 'myob',
    displayName: myobCustomer.CompanyName || myobCustomer.Name,
    firstName: myobCustomer.FirstName || undefined,
    lastName: myobCustomer.LastName || undefined,
    email: myobCustomer.Email || undefined,
    phone: myobCustomer.Phone1 || myobCustomer.Phone || undefined,
    status: myobCustomer.Credit?.OnHold ? 'on_hold' : undefined,
    currency: undefined, // MYOB currency support is product-dependent; not populated in PoC sample data
    updatedAt: toUtcTimestamp(myobCustomer.LastModified),

    _vendorSpecific: {
      rowVersion: myobCustomer.RowVersion,
      currentBalance: myobCustomer.CurrentBalance,
      creditLimit: myobCustomer.Credit?.Limit,
      creditAvailable: myobCustomer.Credit?.Available,
    },
  };
}

module.exports = { mapMyobCustomer };
