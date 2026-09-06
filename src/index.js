const { validate } = require('./canonical/schemas');

const { mapXeroCustomer } = require('./mappers/xero/customerMapper');
const { mapXeroInvoice } = require('./mappers/xero/invoiceMapper');
const { mapXeroPayment } = require('./mappers/xero/paymentMapper');

const { mapMyobCustomer } = require('./mappers/myob/customerMapper');
const { mapMyobInvoice } = require('./mappers/myob/invoiceMapper');
const { mapMyobCustomerPayment, mapMyobSupplierPayment } = require('./mappers/myob/paymentMapper');

const { mapQuickbooksCustomer } = require('./mappers/quickbooks/customerMapper');
const { mapQuickbooksInvoice } = require('./mappers/quickbooks/invoiceMapper');
const { mapQuickbooksPayment } = require('./mappers/quickbooks/paymentMapper');


const REGISTRY = {
  xero: {
    customer: mapXeroCustomer,
    invoice: mapXeroInvoice,
    payment: mapXeroPayment,
  },
  myob: {
    customer: mapMyobCustomer,
    invoice: mapMyobInvoice,
    customerPayment: mapMyobCustomerPayment,
    supplierPayment: mapMyobSupplierPayment,
  },
  quickbooks: {
    customer: mapQuickbooksCustomer,
    invoice: mapQuickbooksInvoice,
    payment: mapQuickbooksPayment,
  },
};

/**
 * Map a raw vendor record to its canonical shape, and validate the result.
 *
 * @param {'xero'|'myob'|'quickbooks'} vendor
 * @param {string} entityType - e.g. 'customer' | 'invoice' | 'payment' | 'customerPayment' | 'supplierPayment'
 * @param {object} raw - the raw record as returned by the vendor's API
 * @returns {{ canonical: object|null, validation: { valid: boolean, errors: string[] } | null }}
 */
function mapToCanonical(vendor, entityType, raw) {
  const vendorMappers = REGISTRY[vendor];
  if (!vendorMappers || !vendorMappers[entityType]) {
    throw new Error(`No mapper registered for vendor='${vendor}' entityType='${entityType}'`);
  }

  const canonical = vendorMappers[entityType](raw);
  if (!canonical) {
    // e.g. Xero ACCPAY invoice filtered out, or a non-customer Xero contact
    return { canonical: null, validation: null };
  }

  // 'customerPayment' / 'supplierPayment' both validate against the
  // canonical 'payment' schema.
  const schemaName = entityType.toLowerCase().includes('payment') ? 'payment' : entityType;
  const validation = validate(schemaName, canonical);

  return { canonical, validation };
}

module.exports = { mapToCanonical, REGISTRY };
