/**
 * Canonical entity schemas for the Provision IT accounting middleware PoC.
 * 
 * Each schema lists the
 * canonical fields, whether they're required, and a one-line description —
 * this mirrors the "Canonical Field" columns in the Mapping Register.
 */

const CUSTOMER_SCHEMA = {
  id: { required: true, description: 'Vendor-native identifier for the customer record' },
  sourceSystem: { required: true, description: "Origin platform: 'xero' | 'myob' | 'quickbooks'" },
  displayName: { required: true, description: 'Display / company name' },
  firstName: { required: false, description: "Contact's first name" },
  lastName: { required: false, description: "Contact's last name" },
  email: { required: false, description: 'Primary email address' },
  phone: { required: false, description: 'Primary phone number' },
  status: { required: false, description: 'Active / archived status' },
  currency: { required: false, description: 'Default currency (ISO 4217)' },
  updatedAt: { required: false, description: 'Canonical last-modified timestamp (UTC ISO 8601)' },
};

const INVOICE_SCHEMA = {
  id: { required: true, description: 'Vendor-native identifier for the invoice' },
  sourceSystem: { required: true, description: "Origin platform: 'xero' | 'myob' | 'quickbooks'" },
  invoiceNumber: { required: false, description: 'Human-readable invoice number' },
  customerId: { required: true, description: 'Reference to canonical Customer.id' },
  transactionDate: { required: true, description: 'Date the invoice was raised (ISO 8601 date)' },
  dueDate: { required: false, description: 'Date payment is due (ISO 8601 date)' },
  lines: { required: false, description: 'Array of canonical invoice lines' },
  total: { required: true, description: 'Total invoice amount including tax' },
  amountDue: { required: false, description: 'Outstanding balance on the invoice' },
  tax: { required: false, description: 'Total tax amount on the invoice' },
  currency: { required: false, description: 'Invoice currency (ISO 4217)' },
  exchangeRate: { required: false, description: 'Exchange rate applied, where applicable' },
  updatedAt: { required: false, description: 'Canonical last-modified timestamp (UTC ISO 8601)' },
};

const PAYMENT_SCHEMA = {
  id: { required: true, description: 'Vendor-native identifier for the payment' },
  sourceSystem: { required: true, description: "Origin platform: 'xero' | 'myob' | 'quickbooks'" },
  direction: { required: true, description: "'receivable' (from a customer) or 'payable' (to a supplier)" },
  partyId: { required: false, description: 'Reference to the canonical Customer/Supplier.id the payment relates to' },
  date: { required: true, description: 'Date the payment was made/received (ISO 8601 date)' },
  amount: { required: true, description: 'Total payment amount' },
  invoiceAllocations: { required: false, description: 'Array of { invoiceId, amount } allocations' },
  accountId: { required: false, description: 'Reference to canonical Account.id' },
  reference: { required: false, description: 'Free-text reference / memo' },
  paymentType: { required: false, description: 'Payment method (bank transfer, cash, card, etc.)' },
  updatedAt: { required: false, description: 'Canonical last-modified timestamp (UTC ISO 8601)' },
};

const SCHEMAS = {
  customer: CUSTOMER_SCHEMA,
  invoice: INVOICE_SCHEMA,
  payment: PAYMENT_SCHEMA,
};

/**
 * Validate a mapped canonical object against its schema's required fields.
 * @param {'customer'|'invoice'|'payment'} entityName
 * @param {object} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(entityName, obj) {
  const schema = SCHEMAS[entityName];
  if (!schema) {
    return { valid: false, errors: [`Unknown canonical entity '${entityName}'`] };
  }

  const errors = [];
  for (const [field, rules] of Object.entries(schema)) {
    if (rules.required && (obj[field] === undefined || obj[field] === null || obj[field] === '')) {
      errors.push(`Missing required canonical field '${field}' (${rules.description})`);
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { SCHEMAS, CUSTOMER_SCHEMA, INVOICE_SCHEMA, PAYMENT_SCHEMA, validate };
