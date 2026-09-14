const { validate } = require("../canonical/schemas");

// Maps Giorgio's database columns (already camelCased) onto Chris's canonical
// field names in src/canonical/schemas.js.
//
// Every column name here was read from the SQL in src/persistence.js.
// Primary keys are per-table (customer_id, invoice_id, payment_id), not `id`.
const FIELD_MAPS = {
  customer: {
    sourceId: "id", // canonical id is vendor-native, i.e. source_id
    name: "displayName",
  },
  invoice: {
    sourceId: "id",
    issueDate: "transactionDate",
    amount: "total",
    customerSourceId: "customerId", // NOT the DB customer_id, see DROP_FIELDS
  },
  payment: {
    sourceId: "id",
    paymentDate: "date",
    method: "paymentType",
    customerSourceId: "partyId",
  },
  // No accounts table exists in the database.
  account: {},
};

// Internal primary/foreign keys. These must not reach the API: they are
// database-local and mean nothing to the portal or to the source platform.
//
// customerId is dropped deliberately. persistence.js joins on
// c.customer_id = i.customer_id, so that column is our internal PK, whereas
// canonical customerId/partyId must reference Customer.id (= source_id).
// Until the SELECTs also return c.source_id AS customer_source_id, these
// references are unavailable and validate() will report them as missing.
const DROP_FIELDS = new Set([
  "customerId",
  "invoiceId",
  "paymentId",
  "connectionId",
]);

/**
 * Derive canonical Payment.direction from the invoice it settles.
 * invoices.type defaults to 'sales_invoice' and distinguishes sales from bills.
 */
function deriveDirection(invoiceType) {
  if (!invoiceType) return undefined;
  return invoiceType.startsWith("sales") ? "receivable" : "payable";
}

/**
 * Rename one camelCased DB row to canonical field names.
 * @param {object} [extra] fields stamped onto every row, e.g. sourceSystem
 */
function toCanonical(entity, row, extra = {}) {
  const map = FIELD_MAPS[entity] || {};
  const out = {};

  for (const key of Object.keys(row)) {
    if (DROP_FIELDS.has(key)) continue;
    out[map[key] || key] = row[key];
  }

  return { ...out, ...extra };
}

/**
 * Map a list of rows and surface schema violations.
 *
 * Invalid rows are still returned, so one missing upstream field cannot blank
 * the portal. The warning makes mapping gaps visible during integration
 * instead of shipping a silently wrong shape.
 */
function toCanonicalList(entity, rows, extra = {}) {
  return rows.map((row) => {
    const mapped = toCanonical(entity, row, extra);
    const { valid, errors } = validate(entity, mapped);
    if (!valid) {
      console.warn(`[canonicalMapper] ${entity} ${mapped.id ?? "(no id)"}: ${errors.join("; ")}`);
    }
    return mapped;
  });
}

module.exports = { toCanonical, toCanonicalList, deriveDirection, FIELD_MAPS };