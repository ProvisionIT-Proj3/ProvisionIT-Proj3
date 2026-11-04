const { toMoney } = require('../../canonical/utils');
const { GROUP_ORDER, groupDefinition, subgroupsOf, resolveClassification } = require('./accountGroups');

/**
 * Vendor mappers parse their TrialBalance into sections of
 * { accountId, name, debit, credit } rows. Header and detail rows are built
 * here so a fix applies to every vendor. Headers come from accountGroups.js.
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

/**
 * A header nets the debits and credits of every detail row beneath it. The
 * vendor reports have no totals for these groups, so none are read from them.
 */
function buildHeaderRow({ id, definition, level, members, sourceSystem, vendorSpecific }) {
  const debit = sumOf(members, 'debit');
  const credit = sumOf(members, 'credit');
  const { drCr, value } = netBalance(debit, credit, definition.normalSide);

  return {
    id,
    sourceSystem,
    code: definition.code,
    name: definition.name,
    type: definition.type,
    drCr,
    isHeader: true,
    level,
    value,
    taxCode: undefined,
    _vendorSpecific: { ...vendorSpecific, memberCount: members.length, synthesized: true },
  };
}

function buildDetailRow({ row, dimension, level, reportSection }, { sourceSystem, fallbackDrCr, vendorSpecific }) {
  const { drCr, value } = netBalance(row.debit, row.credit, fallbackDrCr(dimension));

  return {
    id: row.accountId || `unmatched:${row.name}`,
    sourceSystem,
    code: dimension.code,
    name: dimension.name || row.name || row.accountId,
    type: dimension.type,
    drCr,
    isHeader: false,
    level,
    value,
    taxCode: dimension.taxCode,
    _vendorSpecific: {
      ...vendorSpecific(dimension),
      matchedToAccountsList: Boolean(dimension.id),
      reportSection,
    },
  };
}

/**
 * Sort the detail accounts into { groupKey -> { subgroupKey | '' -> details } },
 * keeping report order inside each bucket.
 */
function bucketByGroup(details, classify) {
  const groups = new Map();

  for (const detail of details) {
    const { groupKey, subgroupKey = '' } = resolveClassification(classify(detail.dimension));
    if (!groups.has(groupKey)) groups.set(groupKey, new Map());
    const subgroups = groups.get(groupKey);
    if (!subgroups.has(subgroupKey)) subgroups.set(subgroupKey, []);
    subgroups.get(subgroupKey).push(detail);
  }

  return groups;
}

/**
 * Build canonical Account rows. Detail accounts come from the trial balance and
 * are grouped by classify(); a header is then synthesised for each group (and
 * subgroup) that has any, with its subtotal. The trial balance's own sections
 * only record where a row came from.
 *
 * Layout: group header (level 1), then each subgroup header (level 2) with its
 * accounts, then the group's accounts that have no subgroup. A detail row sits
 * one level below its header, plus its depth in the vendor's own account tree.
 *
 * @param {object} opts
 * @param {string} opts.sourceSystem - 'xero' | 'quickbooks'
 * @param {Array<{ title: string, rows: Array }>} opts.sections - parsed trial balance
 * @param {Map<string, object>} opts.dimensionById - dimension data by vendor account id
 * @param {(dimension: object) => [string, string?]|undefined} opts.classify - [groupKey, subgroupKey?] for an account
 * @param {(dimension: object) => string|undefined} opts.fallbackDrCr - side for a zero-balance account
 * @param {(dimension: object) => object} opts.vendorSpecific - extra _vendorSpecific fields for a detail row
 * @returns {object[]} canonical Account rows
 */
function buildAccountRows({ sourceSystem, sections, dimensionById, classify, fallbackDrCr, vendorSpecific }) {
  const detailOptions = { sourceSystem, fallbackDrCr, vendorSpecific };

  const details = sections.flatMap((section) =>
    section.rows.map((row) => ({
      row,
      dimension: dimensionById.get(row.accountId) || {},
      reportSection: section.title,
    }))
  );
  const groups = bucketByGroup(details, classify);

  const detailRows = (members, headerLevel) =>
    members.map((m) =>
      buildDetailRow({ ...m, level: headerLevel + 1 + (m.dimension.depth || 0) }, detailOptions)
    );

  const rows = [];
  for (const groupKey of GROUP_ORDER) {
    const subgroups = groups.get(groupKey);
    if (!subgroups) continue;

    const all = [...subgroups.values()].flat().map((m) => m.row);
    rows.push(
      buildHeaderRow({
        id: `header:${groupKey}`,
        definition: groupDefinition(groupKey),
        level: 1,
        members: all,
        sourceSystem,
        vendorSpecific: { groupKey },
      })
    );

    for (const sub of subgroupsOf(groupKey)) {
      const members = subgroups.get(sub.key);
      if (!members) continue;
      rows.push(
        buildHeaderRow({
          id: `header:${sub.key}`,
          definition: sub,
          level: 2,
          members: members.map((m) => m.row),
          sourceSystem,
          vendorSpecific: { groupKey, subgroupKey: sub.key },
        }),
        ...detailRows(members, 2)
      );
    }

    rows.push(...detailRows(subgroups.get('') || [], 1));
  }

  return ensureUniqueIds(rows);
}

module.exports = { parseAmount, netBalance, ensureUniqueIds, indexDimensionsById, buildAccountRows };
