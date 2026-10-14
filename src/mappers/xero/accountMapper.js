const { parseAmount, buildAccountRows } = require('../shared/accountRows');

/**
 * Xero Account mapper.
 * Can't come from a single Xero API call. Built from two calls combined:
 *
 *   1. GET /Accounts               — dimension data: Code, Name, Type,
 *      Class, TaxType. One row per account, no balances, no hierarchy.
 *   2. GET /Reports/TrialBalance    — balance data: Debit/Credit per
 *      account, grouped into named Sections (e.g. "Revenue", "Assets").
 *      No Code or TaxType on this side, and no AccountID on Section rows
 *      (only on the individual account Rows within a Section). The grand
 *      total comes last, as a title-less Section holding only a SummaryRow.
 */

// Xero's Reports/TrialBalance Header row is
// [Account, Debit, Credit, YTD Debit, YTD Credit]. Debit/Credit are the
// movement for the report month; the YTD pair is the as-at balance (in Xero's
// published example a bank account shows Debit 0.00 but YTD Debit 7639.04,
// and only the YTD columns total to the balanced trial balance). So the
// balance is read from the YTD pair, located by header text, falling back to
// this fixed order when the Header row is missing.
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
  EXEMPTCAPITAL: 'FRE',
  EXEMPTEXPENSES: 'FRE',
  GSTONCAPIMPORTS: 'GCA',
  CAPEXINPUT: 'GCA',
  CAPEXOUTPUT: 'GCA',
};

/** Translate a Xero TaxType to the client's tax code vocabulary; */
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
 * @returns {{ id: string, code: string, name: string, type: string, class: string, taxCode: string }}
 */
function mapXeroAccountDimension(xeroAccount) {
  return {
    id: xeroAccount.AccountID,
    code: xeroAccount.Code,
    name: xeroAccount.Name,
    type: xeroAccount.Type,
    class: xeroAccount.Class,
    taxCode: mapXeroTaxCode(xeroAccount.TaxType),
  };
}

/** Parse a report cell's numeric value; Xero reports use '' for empty cells. */
function cellNumber(cell) {
  return parseAmount(cell?.Value, 'Xero');
}

/** Pull the Xero AccountID off a report cell's Attributes, if present. */
function cellAccountId(cell) {
  const attr = (cell?.Attributes || []).find((a) => a.Id === 'account');
  return attr?.Value;
}

/**
 * Find the balance columns from the report's Header row: the YTD pair when
 * present, otherwise the plain Debit/Credit pair, otherwise the fixed order.
 */
function resolveBalanceColumns(report) {
  const header = (report.Rows || []).find((r) => r.RowType === 'Header');
  const titles = (header?.Cells || []).map((c) => String(c.Value ?? '').trim().toLowerCase());
  const find = (title) => {
    const i = titles.indexOf(title);
    return i === -1 ? undefined : i;
  };

  const debit = find('ytd debit') ?? find('debit');
  const credit = find('ytd credit') ?? find('credit');
  if (debit !== undefined && credit !== undefined) return { debit, credit };
  return { debit: COLUMN_INDEX.YTD_DEBIT, credit: COLUMN_INDEX.YTD_CREDIT };
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

  const columns = resolveBalanceColumns(report);
  const sections = [];

  for (const row of report.Rows || []) {
    if (row?.RowType !== 'Section') continue; // skip the column-header Row

    const rows = [];
    let summary = null;

    for (const sectionRow of row.Rows || []) {
      if (!sectionRow) continue;
      const cells = sectionRow.Cells || [];

      if (sectionRow.RowType === 'Row') {
        rows.push({
          accountId: cellAccountId(cells[COLUMN_INDEX.ACCOUNT]),
          name: cells[COLUMN_INDEX.ACCOUNT]?.Value,
          debit: cellNumber(cells[columns.debit]),
          credit: cellNumber(cells[columns.credit]),
        });
      } else if (sectionRow.RowType === 'SummaryRow' && cells.length > Math.max(columns.debit, columns.credit)) {
        // A SummaryRow too short to reach the balance columns is ignored; the header then sums its rows.
        summary = {
          debit: cellNumber(cells[columns.debit]),
          credit: cellNumber(cells[columns.credit]),
        };
      }
    }

    // The grand total arrives as a title-less Section with only a SummaryRow; it isn't a section of accounts.
    if (!row.Title && rows.length === 0) continue;

    sections.push({ title: row.Title, rows, summary });
  }

  return sections;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The report's as-of date ('YYYY-MM-DD'), from ReportDate (e.g. "30 June 2026").
 * This is the organisation's date, not the server's. Null when the report
 * doesn't state one in that form.
 */
function getXeroReportDate(rawReport) {
  const text = rawReport?.Reports?.[0]?.ReportDate;
  const match = typeof text === 'string' && text.trim().match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/);
  if (!match) return null;

  const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
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

  return buildAccountRows({
    sourceSystem: 'xero',
    sections: parseTrialBalanceReport(rawTrialBalanceReport),
    dimensionById,
    fallbackDrCr: (dimension) => DR_CR_BY_CLASS[dimension.class],
    vendorSpecific: (dimension) => ({ class: dimension.class }),
  });
}

module.exports = {
  mapXeroAccountDimension,
  parseTrialBalanceReport,
  buildXeroAccounts,
  getXeroReportDate,
  mapXeroTaxCode,
  XERO_TAX_TYPE_TO_CLIENT_CODE,
  DR_CR_BY_CLASS,
};
