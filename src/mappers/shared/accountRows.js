const { toMoney } = require('../../canonical/utils');

/**
 * Shared by the vendor account mappers. Each vendor parses its own
 * TrialBalance report into sections of { accountId, name, debit, credit }
 * rows; from there the canonical header + detail rows are built the same way
 * for every vendor, so a fix here applies to all of them.
 */

// Plain decimal, or digits grouped in threes ("1,234.50"); a comma anywhere
// else (e.g. European "1.234,50") is rejected rather than misread.
const PLAIN_AMOUNT = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const GROUPED_AMOUNT = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Parse a report amount. Empty means 0. Tolerates thousands separators, a
 * currency symbol and accounting-style negatives "(50.00)". Throws on anything
 * else (including Infinity, exponents and hex, which Number() would accept)
 * rather than silently reporting a wrong balance.
 *
 * @param {*} raw - the cell's value
 * @param {string} vendorLabel - used in the error message, e.g. 'QuickBooks'
 */
function parseAmount(raw, vendorLabel) {
  if (raw === '' || raw === undefined || raw === null) return 0;

  const fail = () => new Error(`Unparseable ${vendorLabel} report amount: ${JSON.stringify(raw)}`);
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw fail();
    return raw;
  }

  let text = String(raw).trim().replace(/[$\s]/g, '');
  if (/^\(.*\)$/.test(text)) text = `-${text.slice(1, -1)}`;

  if (!PLAIN_AMOUNT.test(text) && !GROUPED_AMOUNT.test(text)) throw fail();
  return Number(text.replace(/,/g, ''));
}

/**
 * Net a debit/credit pair into a normal-balance side and a positive value, so
 * negative cells and rows with both sides populated resolve correctly.
 * fallbackDrCr is used when the pair nets to zero.
 */
function netBalance(debit, credit, fallbackDrCr) {
  const net = toMoney(debit - credit); // rounded first so float noise can't pick a side
  return {
    drCr: net > 0 ? 'Dr' : net < 0 ? 'Cr' : fallbackDrCr,
    value: Math.abs(net),
  };
}

/**
 * The accounts table is keyed on (connection, id), so one repeated id would
 * fail the whole sync. Repeats (two sections with the same title, two
 * unmatched rows with the same name, an account listed twice) get a "#n"
 * suffix instead.
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

const sumOf = (rows, field) => rows.reduce((sum, r) => sum + r[field], 0);

/**
 * Build canonical Account rows — a header per section, then its detail rows —
 * from parsed report sections plus the vendor's account dimension data.
 *
 * @param {object} opts
 * @param {string} opts.sourceSystem - 'xero' | 'quickbooks'
 * @param {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>} opts.sections
 * @param {Map<string, object>} opts.dimensionById - mapped dimension data keyed by vendor account id
 * @param {(dimension: object) => string|undefined} opts.fallbackDrCr - normal side for a zero-balance account
 * @param {(dimension: object) => object} opts.vendorSpecific - extra _vendorSpecific fields for a detail row
 * @returns {object[]} canonical Account rows in report order
 */
function buildAccountRows({ sourceSystem, sections, dimensionById, fallbackDrCr, vendorSpecific }) {
  const result = [];

  sections.forEach((section, i) => {
    const sectionIndex = i + 1;
    const title = section.title || `Section ${sectionIndex}`;
    const debit = section.summary?.debit ?? sumOf(section.rows, 'debit');
    const credit = section.summary?.credit ?? sumOf(section.rows, 'credit');
    // A section that nets to zero has no meaningful side, so drCr is left empty.
    const header = netBalance(debit, credit, undefined);

    result.push({
      id: `header:${title}`,
      sourceSystem,
      code: `HDR-${sectionIndex}`,
      name: title,
      type: title,
      drCr: header.drCr,
      isHeader: true,
      level: 1,
      value: header.value,
      taxCode: undefined,
      _vendorSpecific: { sectionRowCount: section.rows.length, synthesizedCode: true },
    });

    for (const row of section.rows) {
      const dimension = dimensionById.get(row.accountId) || {};
      const { drCr, value } = netBalance(row.debit, row.credit, fallbackDrCr(dimension));

      result.push({
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
      });
    }
  });

  return ensureUniqueIds(result);
}

module.exports = { parseAmount, netBalance, ensureUniqueIds, buildAccountRows };
