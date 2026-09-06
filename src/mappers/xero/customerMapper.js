const { toUtcTimestamp, firstDefined } = require('../../canonical/utils');

/**
 * Map a Xero Contact resource to the canonical Customer shape.
 *
 * Xero-specific note (see Mapping Register > Vendor-Specific Data):
 * Xero uses a single Contact resource for both customers and suppliers,
 * with IsCustomer/IsSupplier flags intended to distinguish the two.
 *
 * TODO(confirm with client — tracked pending Sprint 1 sign-off):
 * Real sandbox data pulled via the Xero API showed IsCustomer=false and
 * IsSupplier=false on every contact returned, including contacts that are
 * clearly customers (e.g. invoiced parties). The flags cannot currently be
 * trusted as a reliable "is this a customer" signal.
 *
 * Temporary rule until this is confirmed: a contact is treated as a
 * canonical Customer unless it explicitly claims to be a supplier only
 * (IsSupplier === true and IsCustomer is not also true). A contact that
 * claims neither role (both false/undefined) is assumed to be a customer
 * by default, since customer data is what's in scope for the MVP (FR-06).
 * This is a conservative placeholder, not a confirmed business rule — it
 * should be revisited once we understand why the flags aren't populated
 * (e.g. whether it's a sandbox-only quirk, or whether customer status
 * should instead be derived from invoice history).
 *
 * @param {object} xeroContact - a single entry from Xero's Contacts[] array
 * @returns {object|null} canonical Customer, or null if this contact is explicitly supplier-only
 */
function mapXeroCustomer(xeroContact) {
  if (!xeroContact) return null;

  const isSupplierOnly = xeroContact.IsSupplier === true && xeroContact.IsCustomer !== true;
  if (isSupplierOnly) return null; // explicitly claims supplier, not customer

  const phone = (xeroContact.Phones || []).find((p) => p.PhoneType === 'DEFAULT') || xeroContact.Phones?.[0];

  return {
    id: xeroContact.ContactID,
    sourceSystem: 'xero',
    displayName: xeroContact.Name,
    firstName: xeroContact.FirstName || undefined,
    lastName: xeroContact.LastName || undefined,
    email: xeroContact.EmailAddress || undefined,
    phone: phone ? [phone.PhoneCountryCode, phone.PhoneAreaCode, phone.PhoneNumber].filter(Boolean).join(' ') : undefined,
    status: xeroContact.ContactStatus ? xeroContact.ContactStatus.toLowerCase() : undefined,
    currency: xeroContact.DefaultCurrency || undefined,
    updatedAt: toUtcTimestamp(firstDefined(xeroContact.UpdatedDateUTC, xeroContact.UpdatedDateUTCString)),

    // Vendor-specific fields retained for traceability / debugging, not part
    // of the canonical schema itself (see Vendor-Specific Data Register).
    _vendorSpecific: {
      contactStatusRaw: xeroContact.ContactStatus,
      accountsPayableTaxType: xeroContact.AccountsPayableTaxType,
      isSupplier: xeroContact.IsSupplier,
      isCustomer: xeroContact.IsCustomer,
      // true when neither flag was set and this record was defaulted to
      // Customer by the temporary rule above, rather than confirmed by Xero
      roleAssumedDefault: xeroContact.IsCustomer !== true && xeroContact.IsSupplier !== true,
    },
  };
}

module.exports = { mapXeroCustomer };
