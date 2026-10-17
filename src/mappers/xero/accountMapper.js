const { parseAmount, indexDimensionsById, buildAccountRows } = require('../shared/accountRows');

/**
 * Xero Account mapper. Combines two calls:
 *   1. GET /Accounts — dimension data (Code, Name, Type, Class, TaxType); no balances.
 *   2. GET /Reports/TrialBalance — balances grouped into named Sections; no Code
 *      or TaxType. The grand total is a title-less Section with only a SummaryRow.
 */

// Debit/Credit are the month's movement; the YTD pair is the as-at balance
// (only the YTD columns total to a balanced trial balance). So the balance is
// read from the YTD pair, falling back to this fixed order when the Header
// row is missing.
const COLUMN_INDEX = { ACCOUNT: 0, YTD_DEBIT: 3, YTD_CREDIT: 4 };

// Fallback side for zero-balance accounts, so drCr is still populated.
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

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Translate a Xero TaxType to the client's tax code; unknown types are flagged. */
function mapXeroTaxCode(xeroTaxType) {
  if (!xeroTaxType) return undefined;
  return XERO_TAX_TYPE_TO_CLIENT_CODE[xeroTaxType] || `UNMAPPED:${xeroTaxType}`;
}

/**
 * Map a raw Xero Account to dimension data. Not canonical on its own: balance
 * and hierarchy only exist on the TrialBalance side.
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

function cellNumber(cell) {
  return parseAmount(cell?.Value, 'Xero');
}

function cellAccountId(cell) {
  const attr = (cell?.Attributes || []).find((a) => a.Id === 'account');
  return attr?.Value;
}

/** Locate the balance columns: YTD pair, else plain Debit/Credit, else the fixed order. */
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

function parseAccountRow(cells, columns) {
  return {
    accountId: cellAccountId(cells[COLUMN_INDEX.ACCOUNT]),
    name: cells[COLUMN_INDEX.ACCOUNT]?.Value,
    debit: cellNumber(cells[columns.debit]),
    credit: cellNumber(cells[columns.credit]),
  };
}

function parseSummaryRow(cells, columns) {
  return {
    debit: cellNumber(cells[columns.debit]),
    credit: cellNumber(cells[columns.credit]),
  };
}

/** Parse one report Section; null for the title-less grand-total Section. */
function parseSection(section, columns) {
  const rows = [];
  let summary = null;

  for (const sectionRow of section.Rows || []) {
    const cells = sectionRow.Cells || [];

    if (sectionRow.RowType === 'Row') {
      rows.push(parseAccountRow(cells, columns));
    } else if (sectionRow.RowType === 'SummaryRow' && cells.length > Math.max(columns.debit, columns.credit)) {
      // A SummaryRow too short to reach the balance columns is ignored; the header then sums its rows.
      summary = parseSummaryRow(cells, columns);
    }
  }

  if (!section.Title && rows.length === 0) return null;
  return { title: section.Title, rows, summary };
}

/**
 * Parse a raw Xero Reports/TrialBalance response into sections, each with its
 * title, account rows and summary totals (where Xero provides a SummaryRow).
 * @param {object} rawReport - the raw { Reports: [...] } response
 * @returns {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>}
 */
function parseTrialBalanceReport(rawReport) {
  const report = rawReport?.Reports?.[0];
  if (!report) return [];

  const columns = resolveBalanceColumns(report);

  return (report.Rows || [])
    .filter((row) => row.RowType === 'Section') // drops the column-header Row
    .map((section) => parseSection(section, columns))
    .filter(Boolean);
}

/**
 * The report's as-of date ('YYYY-MM-DD') from ReportDate (e.g. "30 June 2026").
 * It's the organisation's date, not the server's. Null if absent or malformed.
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
 * Build canonical Account rows (headers and details) from the two raw Xero inputs.
 * @param {object[]} rawAccounts - raw response array from GET /Accounts
 * @param {object} rawTrialBalanceReport - raw response from GET /Reports/TrialBalance
 * @returns {object[]} canonical Account rows in report order
 */
function buildXeroAccounts(rawAccounts, rawTrialBalanceReport) {
  return buildAccountRows({
    sourceSystem: 'xero',
    sections: parseTrialBalanceReport(rawTrialBalanceReport),
    dimensionById: indexDimensionsById(rawAccounts, mapXeroAccountDimension),
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
  DR_CR_BY_CLASS,
};
