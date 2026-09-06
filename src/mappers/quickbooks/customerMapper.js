const { toUtcTimestamp } = require('../../canonical/utils');

/**
 * Map a QuickBooks Online Customer resource to the canonical Customer shape.
 * @param {object} qboCustomer
 * @returns {object|null}
 */
function mapQuickbooksCustomer(qboCustomer) {
  if (!qboCustomer) return null;

  return {
    id: qboCustomer.Id,
    sourceSystem: 'quickbooks',
    displayName: qboCustomer.DisplayName || qboCustomer.CompanyName || qboCustomer.FullyQualifiedName,
    firstName: qboCustomer.GivenName || undefined,
    lastName: qboCustomer.FamilyName || undefined,
    email: qboCustomer.PrimaryEmailAddr?.Address || undefined,
    phone: qboCustomer.PrimaryPhone?.FreeFormNumber || undefined,
    status: qboCustomer.Active === false ? 'archived' : 'active',
    currency: qboCustomer.CurrencyRef?.value || undefined,
    updatedAt: toUtcTimestamp(qboCustomer.MetaData?.LastUpdatedTime),

    _vendorSpecific: {
      fullyQualifiedName: qboCustomer.FullyQualifiedName,
      taxable: qboCustomer.Taxable,
      createTime: qboCustomer.MetaData?.CreateTime,
    },
  };
}

module.exports = { mapQuickbooksCustomer };
