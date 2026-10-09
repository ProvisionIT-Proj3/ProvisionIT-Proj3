const { toMoney } = require('../../canonical/utils');

/**
 * QuickBooks Online Account mapper.
 *
 *   1. GET /query?query=select * from Account — dimension data: AcctNum,
 *      Name, AccountType, Classification, TaxCodeRef. One row per account,
 *      no balances, no hierarchy.
 */

const COLUMN_INDEX = { ACCOUNT: 0, DEBIT: 1, CREDIT: 2 };


const DR_CR_BY_CLASSIFICATION = {
  Asset: 'Dr',
  Expense: 'Dr',
  Liability: 'Cr',
  Equity: 'Cr',
  Revenue: 'Cr',
};

const QBO_TAX_CODE_REF_TO_CLIENT_CODE = {
  2: 'GST',
  3: 'N-T',
};

function mapQuickbooksTaxCode(taxCodeRef) {
  const ref = taxCodeRef?.value;
  if (ref === undefined || ref === null || ref === '') return undefined;
  return QBO_TAX_CODE_REF_TO_CLIENT_CODE[ref] || `UNMAPPED:${ref}`;
}

/**
 * Map a single raw QuickBooks Account to reference/dimension data. Not a
 * canonical record on its own.
 *
 * @param {object} qboAccount
 * @returns {{ id: string, code: string, name: string, type: string, classification: string, taxCode: string }}
 */
function mapQuickbooksAccountDimension(qboAccount) {
  return {
    id: qboAccount.Id,
    code: qboAccount.AcctNum || qboAccount.Id, // AcctNum is optional and often blank; Id substitutes when missing
    name: qboAccount.Name,
    type: qboAccount.AccountType,
    classification: qboAccount.Classification,
    taxCode: mapQuickbooksTaxCode(qboAccount.TaxCodeRef),
  };
}

/** Parse a report cell's numeric value; QBO reports use '' for empty cells. */
function cellNumber(cell) {
  if (!cell || cell.value === '' || cell.value === undefined) return 0;
  const n = Number(cell.value);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse a raw QuickBooks TrialBalance report into a flat list of sections,
 * each with its title, rows (one per account), and summary totals where QBO
 * provides a Summary row.
 * @param {object} rawReport - the raw TrialBalance report response
 * @returns {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>}
 */
function parseTrialBalanceReport(rawReport) {
  const topRows = rawReport?.Rows?.Row || [];
  const sections = [];

  for (const row of topRows) {
    if (row.type !== 'Section') continue;

    const rows = [];
    for (const childRow of row.Rows?.Row || []) {
      if (childRow.type !== 'Data') continue;
      const cells = childRow.ColData || [];
      rows.push({
        accountId: cells[COLUMN_INDEX.ACCOUNT]?.id,
        name: cells[COLUMN_INDEX.ACCOUNT]?.value,
        debit: cellNumber(cells[COLUMN_INDEX.DEBIT]),
        credit: cellNumber(cells[COLUMN_INDEX.CREDIT]),
      });
    }

    const summaryCells = row.Summary?.ColData;
    const summary = summaryCells
      ? {
          debit: cellNumber(summaryCells[COLUMN_INDEX.DEBIT]),
          credit: cellNumber(summaryCells[COLUMN_INDEX.CREDIT]),
        }
      : null;

    sections.push({ title: row.Header?.ColData?.[COLUMN_INDEX.ACCOUNT]?.value, rows, summary });
  }

  return sections;
}

/**
 * Build the full canonical Account list — header rows and detail rows — for
 * the client's requested report shape, from the two raw QuickBooks inputs.
 *
 * @param {object[]} rawAccounts - raw response array from the Account query
 * @param {object} rawTrialBalanceReport - raw response from GET /reports/TrialBalance
 * @returns {object[]} canonical Account rows, in report order (header, then its detail rows, per section)
 */
function buildQuickbooksAccounts(rawAccounts, rawTrialBalanceReport) {
  const dimensionById = new Map(
    (rawAccounts || []).map((a) => {
      const d = mapQuickbooksAccountDimension(a);
      return [d.id, d];
    })
  );

  const sections = parseTrialBalanceReport(rawTrialBalanceReport);
  const result = [];
  let sectionIndex = 0;

  for (const section of sections) {
    sectionIndex += 1;
    const sectionDebit = section.summary?.debit ?? section.rows.reduce((sum, r) => sum + r.debit, 0);
    const sectionCredit = section.summary?.credit ?? section.rows.reduce((sum, r) => sum + r.credit, 0);
    const headerDrCr = sectionDebit >= sectionCredit ? 'Dr' : 'Cr';

    const headerCode = `HDR-${sectionIndex}`;

    result.push({
      id: `header:${section.title}`,
      sourceSystem: 'quickbooks',
      code: headerCode,
      name: section.title,
      type: section.title,
      drCr: headerDrCr,
      isHeader: true,
      level: 1,
      value: toMoney(Math.max(sectionDebit, sectionCredit)),
      taxCode: undefined,
      _vendorSpecific: { sectionRowCount: section.rows.length, synthesizedCode: true },
    });

    for (const row of section.rows) {
      const dimension = dimensionById.get(row.accountId) || {};
      const drCr =
        row.debit > 0 ? 'Dr' : row.credit > 0 ? 'Cr' : DR_CR_BY_CLASSIFICATION[dimension.classification] || undefined;
      const value = toMoney(row.debit > 0 ? row.debit : row.credit);

      result.push({
        id: row.accountId || `unmatched:${row.name}`,
        sourceSystem: 'quickbooks',
        code: dimension.code,
        name: dimension.name || row.name,
        type: dimension.type,
        drCr,
        isHeader: false,
        level: 2,
        value,
        taxCode: dimension.taxCode,
        _vendorSpecific: {
          classification: dimension.classification,
          matchedToAccountsList: Boolean(dimension.id),
        },
      });
    }
  }

  return result;
}

module.exports = {
  mapQuickbooksAccountDimension,
  parseTrialBalanceReport,
  buildQuickbooksAccounts,
  mapQuickbooksTaxCode,
  DR_CR_BY_CLASSIFICATION,
};
