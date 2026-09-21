const { validate } = require("../canonical/schemas");
const { toUtcTimestamp, toISODate, toMoney } = require("../canonical/utils");

// Maps Giorgio's database columns (already camelCased) onto Chris's canonical
// field names in src/canonical/schemas.js.
//
// This is the READ path: stored row -> canonical response. Chris's
// src/mappers/<vendor>/ handle the WRITE path (vendor API -> canonical) and
// run before anything is persisted. Both are needed because the database
// stores its own column names, not canonical ones.
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
  // Accounts are built by Chris's buildXeroAccounts() and stored in the
  // accounts table. Column names already match canonical once camelCased
  // (dr_cr -> drCr, is_header -> isHeader, tax_code -> taxCode), so only the
  // vendor id needs renaming.
  account: {
    sourceId: "id",
  },
};

// Normalisation applied per canonical field, reusing Chris's shared helpers so
// date and money handling stays identical across the read and write paths.
const NORMALISERS = {
  updatedAt: toUtcTimestamp,
  transactionDate: toISODate,
  dueDate: toISODate,
  date: toISODate,
  total: toMoney,
  amount: toMoney,
  value: toMoney,
};

// Internal primary/foreign keys. These must not reach the API: they are
// database-local and mean nothing to the portal or to the source platform.
//
// customerId is dropped deliberately. persistence.js joins on
// c.customer_id = i.customer_id, so that column is our internal PK, whereas
// canonical customerId/partyId must reference Customer.id (= source_id).
const DROP_FIELDS = new Set([
  "customerId",
  "invoiceId",
  "paymentId",
  "connectionId",
  "createdAt", // internal insert timestamp on every table; not part of the canonical shape
  "accountId", // internal PK of the accounts table
  "sortOrder", // storage detail; order is applied by the query, not exposed
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
 * Rename one camelCased DB row to canonical field names and normalise values.
 * @param {object} [extra] fields stamped onto every row, e.g. sourceSystem
 */
function toCanonical(entity, row, extra = {}) {
  const map = FIELD_MAPS[entity] || {};
  const out = {};

  for (const key of Object.keys(row)) {
    if (DROP_FIELDS.has(key)) continue;

    const canonicalKey = map[key] || key;
    const normalise = NORMALISERS[canonicalKey];
    out[canonicalKey] = normalise ? normalise(row[key]) : row[key];
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