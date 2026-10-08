const { validate } = require("../canonical/schemas");
const { toUtcTimestamp, toMoney } = require("../canonical/utils");

// Maps Giorgio's database columns (already camelCased) onto Chris's canonical
// field names in src/canonical/schemas.js.
//
// This is the READ path: stored row -> canonical response, used by
// dataService.getAccounts. Every column name here was read from the SQL in
// src/persistence.js.
const FIELD_MAPS = {
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
  value: toMoney,
};

// Internal columns that must not reach the API: database-local and mean
// nothing to the portal or to the source platform.
const DROP_FIELDS = new Set([
  "connectionId",
  "createdAt", // internal insert timestamp; not part of the canonical shape
  "accountId", // internal PK of the accounts table
  "sortOrder", // storage detail; order is applied by the query, not exposed
  "reportDate", // surfaced once as meta.reportDate in getAccounts, not per row
]);

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

module.exports = { toCanonical, toCanonicalList, FIELD_MAPS };
