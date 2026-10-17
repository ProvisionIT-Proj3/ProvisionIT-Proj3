const { toMoney } = require('../../canonical/utils');

/**
 * Vendor mappers parse their TrialBalance into sections of
 * { accountId, name, debit, credit } rows. Header and detail rows are built
 * here so a fix applies to every vendor.
 */

// Plain decimals or comma-grouped thousands; European "1.234,50" is rejected, not misread.
const PLAIN_AMOUNT = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const GROUPED_AMOUNT = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Parse a report amount; empty means 0. Throws on anything unparseable
 * (Number() would accept Infinity, exponents and hex) rather than silently
 * reporting a wrong balance.
 * @param {*} raw - the cell's value
 * @param {string} vendorLabel - used in the error message
 */
function parseAmount(raw, vendorLabel) {
  if (raw === '' || raw === undefined || raw === null) return 0;

  const fail = () => new Error(`Unparseable ${vendorLabel} report amount: ${JSON.stringify(raw)}`);
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw fail();
    return raw;
  }

  let text = String(raw).trim().replace(/[$\s]/g, '');
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`; // accounting negative "(50.00)"

  if (!PLAIN_AMOUNT.test(text) && !GROUPED_AMOUNT.test(text)) throw fail();
  const amount = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(amount)) throw fail(); // a string of 309+ digits overflows to Infinity
  return amount;
}

/**
 * Net a debit/credit pair into a side and a positive value, so negative cells
 * and rows with both sides populated resolve correctly. fallbackDrCr applies
 * when the pair nets to zero.
 */
function netBalance(debit, credit, fallbackDrCr) {
  const net = toMoney(debit - credit); // rounded first so float noise can't pick a side
  return {
    drCr: net > 0 ? 'Dr' : net < 0 ? 'Cr' : fallbackDrCr,
    value: Math.abs(net),
  };
}

/**
 * The accounts table is keyed on (connection, id), so a repeated id would fail
 * the whole sync. Repeats get a "#n" suffix instead.
 */
function ensureUniqueIds(rows) {
  const seen = new Map();

  return rows.map((row) => {
    const count = (seen.get(row.id) || 0) + 1;
    seen.set(row.id, count);
    if (count === 1) return row;

    return {
      ...row,
      id: `${row.id}#${count}`,
      _vendorSpecific: { ...row._vendorSpecific, duplicateOf: row.id },
    };
  });
}

/** Map raw vendor accounts to dimension data, indexed by dimension id. */
function indexDimensionsById(rawAccounts, mapDimension) {
  return new Map(
    (rawAccounts || []).map((raw) => {
      const dimension = mapDimension(raw);
      return [dimension.id, dimension];
    })
  );
}

const sumOf = (rows, field) => rows.reduce((sum, r) => sum + r[field], 0);

function buildHeaderRow(section, sectionIndex, sourceSystem) {
  const title = section.title || `Section ${sectionIndex}`;
  const debit = section.summary?.debit ?? sumOf(section.rows, 'debit');
  const credit = section.summary?.credit ?? sumOf(section.rows, 'credit');
  // No fallback: a section netting to zero has no meaningful side.
  const { drCr, value } = netBalance(debit, credit, undefined);

  return {
    id: `header:${title}`,
    sourceSystem,
    code: `HDR-${sectionIndex}`,
    name: title,
    type: title,
    drCr,
    isHeader: true,
    level: 1,
    value,
    taxCode: undefined,
    _vendorSpecific: { sectionRowCount: section.rows.length, synthesizedCode: true },
  };
}

function buildDetailRow(row, dimension, { sourceSystem, fallbackDrCr, vendorSpecific }) {
  const { drCr, value } = netBalance(row.debit, row.credit, fallbackDrCr(dimension));

  return {
    id: row.accountId || `unmatched:${row.name}`,
    sourceSystem,
    code: dimension.code,
    name: dimension.name || row.name || row.accountId,
    type: dimension.type,
    drCr,
    isHeader: false,
    level: 2,
    value,
    taxCode: dimension.taxCode,
    _vendorSpecific: {
      ...vendorSpecific(dimension),
      matchedToAccountsList: Boolean(dimension.id),
    },
  };
}

/**
 * Build canonical Account rows: a header per section, then its details.
 *
 * @param {object} opts
 * @param {string} opts.sourceSystem - 'xero' | 'quickbooks'
 * @param {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>} opts.sections
 * @param {Map<string, object>} opts.dimensionById - dimension data by vendor account id
 * @param {(dimension: object) => string|undefined} opts.fallbackDrCr - side for a zero-balance account
 * @param {(dimension: object) => object} opts.vendorSpecific - extra _vendorSpecific fields for a detail row
 * @returns {object[]} canonical Account rows in report order
 */
function buildAccountRows({ sourceSystem, sections, dimensionById, fallbackDrCr, vendorSpecific }) {
  const detailOptions = { sourceSystem, fallbackDrCr, vendorSpecific };

  const rows = sections.flatMap((section, i) => [
    buildHeaderRow(section, i + 1, sourceSystem),
    ...section.rows.map((row) =>
      buildDetailRow(row, dimensionById.get(row.accountId) || {}, detailOptions)
    ),
  ]);

  return ensureUniqueIds(rows);
}

module.exports = { parseAmount, netBalance, ensureUniqueIds, indexDimensionsById, buildAccountRows };
