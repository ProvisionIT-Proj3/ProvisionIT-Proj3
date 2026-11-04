const ACCOUNT_SCHEMA = {
  id: { required: true, description: 'Vendor-native identifier for the account (or a synthetic id for a header row)' },
  sourceSystem: { required: true, description: "Origin platform: 'xero' | 'myob' | 'quickbooks'" },
  code: { required: false, description: "Account # — the account's code (header rows get a synthesized MYOB-style code, e.g. '1-0000', as the vendors have no header accounts)" },
  name: { required: true, description: 'Account — the account or section name' },
  type: { required: false, description: 'Type — specific account type/class (e.g. Bank, Cost of Sales)' },
  drCr: { required: false, description: "Dr/Cr — normal balance side, 'Dr' or 'Cr'" },
  isHeader: { required: true, description: 'Header/Detail — true for a grouping/section row, false for a postable account' },
  level: { required: true, description: 'Level — depth in the account hierarchy (1 = top-level group header; a subgroup header is 2; a detail account sits one level below its header, deeper for sub-accounts)' },
  value: { required: false, description: 'Value — the balance for the reporting period' },
  taxCode: { required: false, description: "Tax Code — default tax code for the account" },
  updatedAt: { required: false, description: 'Canonical last-modified timestamp (UTC ISO 8601)' },
};

const SCHEMAS = {
  account: ACCOUNT_SCHEMA,
};

const isMissing = (value) => value === undefined || value === null || value === '';

/**
 * Check a mapped object for its schema's required fields.
 * @param {'account'} entityName
 * @param {object} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validate(entityName, obj) {
  const schema = SCHEMAS[entityName];
  if (!schema) {
    return { valid: false, errors: [`Unknown canonical entity '${entityName}'`] };
  }

  const errors = Object.entries(schema)
    .filter(([field, rules]) => rules.required && isMissing(obj[field]))
    .map(([field, rules]) => `Missing required canonical field '${field}' (${rules.description})`);

  return { valid: errors.length === 0, errors };
}

module.exports = { SCHEMAS, ACCOUNT_SCHEMA, validate };
