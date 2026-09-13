const { toMoney } = require('../../canonical/utils');

/**
 * Xero Account mapper.
 * Can't come from a single Xero API call. Built from two calls combined:
 *
 *   1. GET /Accounts               — dimension data: Code, Name, Type,
 *      Class, TaxType. One row per account, no balances, no hierarchy.
 *   2. GET /Reports/TrialBalance    — balance data: Debit/Credit per
 *      account, grouped into named Sections (e.g. "Revenue", "Bank").
 *      No Code or TaxType on this side, and no AccountID on Section rows
 *      (only on the individual account Rows within a Section).
 */

// Column order confirmed from Xero's Reports/TrialBalance Header row:
// [Account, Debit, Credit, YTD Debit, YTD Credit]
const COLUMN_INDEX = { ACCOUNT: 0, DEBIT: 1, CREDIT: 2, YTD_DEBIT: 3, YTD_CREDIT: 4 };

// Standard double-entry convention, keyed on Xero's Class field.
// Used as a fallback when a row has no balance in either Debit or Credit
// (e.g. a zero-balance account) so drCr is still populated.
const DR_CR_BY_CLASS = {
  ASSET: 'Dr',
  EXPENSE: 'Dr',
  LIABILITY: 'Cr',
  EQUITY: 'Cr',
  REVENUE: 'Cr',
};

const XERO_TAX_TYPE_TO_CLIENT_CODE = {
  NONE: 'N-T',
  BASEXCLUDED: 'N-T',
  OUTPUT: 'GST',
  OUTPUT2: 'GST',
  INPUT: 'GST',
  INPUT2: 'GST',
  EXEMPTOUTPUT: 'FRE',
  EXEMPTINPUT: 'FRE',
  EXEMPTEXPORT: 'FRE',
  GSTONCAPIMPORTS: 'GCA',
  CAPEXINPUT: 'GCA',
  CAPEXOUTPUT: 'GCA',
};

/** Translate a Xero TaxType to the client's tax code vocabulary; see TODO above. */
function mapXeroTaxCode(xeroTaxType) {
  if (!xeroTaxType) return undefined;
  return XERO_TAX_TYPE_TO_CLIENT_CODE[xeroTaxType] || `UNMAPPED:${xeroTaxType}`;
}

/**
 * Map a single raw Xero Account (from GET /Accounts) to reference/dimension
 * data. Not a canonical record on its own — has no balance or hierarchy
 * info, both of which only exist on the TrialBalance side.
 *
 * @param {object} xeroAccount
 * @returns {{ id: string, code: string, nativeCode: string|undefined, name: string, type: string, class: string, taxCode: string }}
 */
function mapXeroAccountDimension(xeroAccount) {
  return {
    id: xeroAccount.AccountID,
    code: xeroAccount.AccountID,
    nativeCode: xeroAccount.Code,
    name: xeroAccount.Name,
    type: xeroAccount.Type,
    class: xeroAccount.Class,
    taxCode: mapXeroTaxCode(xeroAccount.TaxType),
  };
}

/** Parse a report cell's numeric value; Xero reports use '' for empty cells. */
function cellNumber(cell) {
  if (!cell || cell.Value === '' || cell.Value === undefined) return 0;
  const n = Number(cell.Value);
  return Number.isNaN(n) ? 0 : n;
}

/** Pull the Xero AccountID off a report cell's Attributes, if present. */
function cellAccountId(cell) {
  const attr = (cell?.Attributes || []).find((a) => a.Id === 'account');
  return attr?.Value;
}

/**
 * Parse a raw Xero Reports/TrialBalance response into a flat list of
 * sections, each with its title, rows (one per account), and summary
 * totals where Xero provides a SummaryRow.
 * @param {object} rawReport - the raw { Reports: [...] } response
 * @returns {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>}
 */
function parseTrialBalanceReport(rawReport) {
  const report = rawReport?.Reports?.[0];
  if (!report) return [];

  const sections = [];

  for (const row of report.Rows || []) {
    if (row.RowType !== 'Section') continue; // skip the column-header Row

    const rows = [];
    let summary = null;

    for (const sectionRow of row.Rows || []) {
      if (sectionRow.RowType === 'Row') {
        const cells = sectionRow.Cells || [];
        rows.push({
          accountId: cellAccountId(cells[COLUMN_INDEX.ACCOUNT]),
          name: cells[COLUMN_INDEX.ACCOUNT]?.Value,
          debit: cellNumber(cells[COLUMN_INDEX.DEBIT]),
          credit: cellNumber(cells[COLUMN_INDEX.CREDIT]),
        });
      } else if (sectionRow.RowType === 'SummaryRow') {
        const cells = sectionRow.Cells || [];
        summary = {
          debit: cellNumber(cells[COLUMN_INDEX.DEBIT]),
          credit: cellNumber(cells[COLUMN_INDEX.CREDIT]),
        };
      }
    }

    sections.push({ title: row.Title, rows, summary });
  }

  return sections;
}

/**
 * Build the full canonical Account list — header rows and detail rows —
 * for the client's requested report shape, from the two raw Xero inputs.
 *
 * @param {object[]} rawAccounts - raw response array from GET /Accounts
 * @param {object} rawTrialBalanceReport - raw response from GET /Reports/TrialBalance
 * @returns {object[]} canonical Account rows, in report order (header, then its detail rows, per section)
 */
function buildXeroAccounts(rawAccounts, rawTrialBalanceReport) {
  const dimensionById = new Map(
    (rawAccounts || []).map((a) => {
      const d = mapXeroAccountDimension(a);
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
      sourceSystem: 'xero',
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
      const drCr = row.debit > 0 ? 'Dr' : row.credit > 0 ? 'Cr' : DR_CR_BY_CLASS[dimension.class] || undefined;
      const value = toMoney(row.debit > 0 ? row.debit : row.credit);

      result.push({
        id: row.accountId || `unmatched:${row.name}`,
        sourceSystem: 'xero',
        code: dimension.code,
        name: dimension.name || row.name,
        type: dimension.type,
        drCr,
        isHeader: false,
        level: 2,
        value,
        taxCode: dimension.taxCode,
        _vendorSpecific: {
          class: dimension.class,
          nativeCode: dimension.nativeCode,
          matchedToAccountsList: Boolean(dimension.id),
        },
      });
    }
  }

  return result;
}

module.exports = {
  mapXeroAccountDimension,
  parseTrialBalanceReport,
  buildXeroAccounts,
  mapXeroTaxCode,
  DR_CR_BY_CLASS,
};
