const ACCOUNT_SCHEMA = {
  id: { required: true, description: 'Vendor-native identifier for the account (or a synthetic id for a header row)' },
  sourceSystem: { required: true, description: "Origin platform: 'xero' | 'myob' | 'quickbooks'" },
  code: { required: false, description: "Account # — the account's code (synthesized, e.g. 'HDR-N', for header rows without a native identifier)" },
  name: { required: true, description: 'Account — the account or section name' },
  type: { required: false, description: 'Type — specific account type/class (e.g. Bank, Cost of Sales)' },
  drCr: { required: false, description: "Dr/Cr — normal balance side, 'Dr' or 'Cr'" },
  isHeader: { required: true, description: 'Header/Detail — true for a grouping/section row, false for a postable account' },
  level: { required: true, description: 'Level — depth in the account hierarchy (1 = header/section, 2 = detail account)' },
  value: { required: false, description: 'Value — the balance for the reporting period' },
  taxCode: { required: false, description: "Tax Code — default tax code for the account" },
  updatedAt: { required: false, description: 'Canonical last-modified timestamp (UTC ISO 8601)' },
};

const SCHEMAS = {
  account: ACCOUNT_SCHEMA,
};

/**
 * Validate a mapped canonical object against its schema's required fields.
 * @param {'account'} entityName
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

module.exports = { SCHEMAS, ACCOUNT_SCHEMA, validate };
