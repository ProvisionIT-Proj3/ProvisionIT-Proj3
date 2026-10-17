const { parseAmount, indexDimensionsById, buildAccountRows } = require('../shared/accountRows');

/**
 * QuickBooks Online Account mapper. Combines three calls:
 *   1. Query: select * from Account — dimension data; no balances.
 *   2. GET /reports/TrialBalance — balances, usually flat rows plus a
 *      title-less GrandTotal section.
 *   3. Query: select * from TaxCode — resolves TaxCodeRef ids to names,
 *      since ids differ per QBO company.
 */

const COLUMN_INDEX = { ACCOUNT: 0, DEBIT: 1, CREDIT: 2 };

// Matches "Total Assets" but not an account like "Totalizer Fees".
const TOTAL_LINE_LABEL = /^\s*total\b/i;

// Fallback side for zero-balance accounts, so drCr is still populated.
const DR_CR_BY_CLASSIFICATION = {
  Asset: 'Dr',
  Expense: 'Dr',
  Liability: 'Cr',
  Equity: 'Cr',
  Revenue: 'Cr',
};

// Keyed on the AU TaxCode Name (via taxCodeKey), mapped onto the same client
// codes as the Xero mapper. Input tax has no client code, same as Xero's
// INPUTTAXED. Unlisted names come through as UNMAPPED:<name>.
const QBO_TAX_CODE_NAME_TO_CLIENT_CODE = {
  'GST': 'GST',
  'GST ON NON CAPITAL': 'GST',
  'GST ON PURCHASES': 'GST',
  'GST ON CAPITAL': 'GCA',
  'GST FREE': 'FRE',
  'GST FREE EXPORT': 'FRE',
  'GST FREE CAPITAL': 'FRE',
  'GST FREE NON CAPITAL': 'FRE',
  'GST FREE PURCHASES': 'FRE',
  'OUT OF SCOPE': 'N-T',
};

/** Spelling and case vary ("GST-free non-capital"), so names are matched on this key. */
function taxCodeKey(name) {
  return name.trim().toUpperCase().replace(/[-\s]+/g, ' ');
}

/**
 * Translate an Account's TaxCodeRef to the client's tax code.
 * @param {{ value: string }} taxCodeRef
 * @param {Map<string, string>} [taxCodeNameById] - TaxCode Id -> Name
 */
function mapQuickbooksTaxCode(taxCodeRef, taxCodeNameById = new Map()) {
  const ref = taxCodeRef?.value;
  if (ref === undefined || ref === null || ref === '') return undefined;

  const name = taxCodeNameById.get(String(ref));
  if (!name) return `UNMAPPED:${ref}`;
  return QBO_TAX_CODE_NAME_TO_CLIENT_CODE[taxCodeKey(name)] || `UNMAPPED:${name}`;
}

/**
 * Map a raw QuickBooks Account to dimension data. Not canonical on its own.
 * @param {object} qboAccount
 * @param {Map<string, string>} [taxCodeNameById]
 * @returns {{ id: string, code: string, name: string, type: string, classification: string, taxCode: string }}
 */
function mapQuickbooksAccountDimension(qboAccount, taxCodeNameById) {
  return {
    id: qboAccount.Id,
    code: qboAccount.AcctNum || qboAccount.Id, // AcctNum is optional and often blank
    name: qboAccount.Name,
    type: qboAccount.AccountType,
    classification: qboAccount.Classification,
    taxCode: mapQuickbooksTaxCode(qboAccount.TaxCodeRef, taxCodeNameById),
  };
}

function cellNumber(cell) {
  return parseAmount(cell?.value, 'QuickBooks');
}

function isDataRow(row) {
  return (row.type === 'Data' || row.type == null) && Array.isArray(row.ColData);
}

function parseAccountRow(row) {
  const cells = row.ColData;

  return {
    accountId: cells[COLUMN_INDEX.ACCOUNT]?.id,
    name: cells[COLUMN_INDEX.ACCOUNT]?.value,
    debit: cellNumber(cells[COLUMN_INDEX.DEBIT]),
    credit: cellNumber(cells[COLUMN_INDEX.CREDIT]),
  };
}

// An id-less "Total ..." row would be counted as an account and double its
// section's balance. A row with an id is never skipped.
function toAccountRow(row) {
  const account = parseAccountRow(row);
  const isTotalLine = !account.accountId && TOTAL_LINE_LABEL.test(String(account.name ?? ''));
  return isTotalLine ? null : account;
}

// Descends into nested sections so sub-accounts aren't dropped; the outer
// Summary already covers nested subtotals.
function collectAccountRows(childRows) {
  const rows = [];
  for (const child of childRows || []) {
    if (!child) continue;
    if (child.type === 'Section') {
      rows.push(...collectAccountRows(child.Rows?.Row));
    } else if (isDataRow(child)) {
      const account = toAccountRow(child);
      if (account) rows.push(account);
    }
  }
  return rows;
}

function parseSummary(summaryCells) {
  if (!summaryCells) return null;

  return {
    debit: cellNumber(summaryCells[COLUMN_INDEX.DEBIT]),
    credit: cellNumber(summaryCells[COLUMN_INDEX.CREDIT]),
  };
}

/** Parse one report Section; null for a summary-only Section (e.g. GrandTotal). */
function parseSection(section) {
  const title = section.Header?.ColData?.[COLUMN_INDEX.ACCOUNT]?.value;
  if (!title) return null;

  return {
    title,
    rows: collectAccountRows(section.Rows?.Row),
    summary: parseSummary(section.Summary?.ColData),
  };
}

/**
 * Parse a raw QuickBooks TrialBalance report into sections, each with its
 * title, account rows and summary totals (where QBO provides a Summary row).
 * Top-level flat account rows are grouped into one 'Accounts' section.
 * @param {object} rawReport - the raw TrialBalance report response
 * @returns {Array<{ title: string, rows: Array, summary: { debit: number, credit: number } | null }>}
 */
function parseTrialBalanceReport(rawReport) {
  const sections = [];
  let flatRows = [];

  const flushFlatRows = () => {
    if (flatRows.length === 0) return;
    sections.push({ title: 'Accounts', rows: flatRows, summary: null });
    flatRows = [];
  };

  for (const row of rawReport?.Rows?.Row || []) {
    if (!row) continue;
    if (row.type === 'Section') {
      flushFlatRows();
      const section = parseSection(row);
      if (section) sections.push(section);
    } else if (isDataRow(row)) {
      // Kept without an id (as "unmatched:<name>") so its balance isn't lost.
      const account = toAccountRow(row);
      if (account) flatRows.push(account);
    }
  }

  flushFlatRows();

  return sections;
}

/**
 * The report's as-of date ('YYYY-MM-DD') from Header.EndPeriod. It's the
 * company's date, not the server's. Null if absent or malformed.
 */
function getQuickbooksReportDate(rawReport) {
  const end = rawReport?.Header?.EndPeriod;
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
}

/**
 * Build canonical Account rows (headers and details) from the raw QuickBooks inputs.
 * @param {object[]} rawAccounts - raw response array from the Account query
 * @param {object} rawTrialBalanceReport - raw response from GET /reports/TrialBalance
 * @param {object[]} [rawTaxCodes] - raw response array from the TaxCode query
 * @returns {object[]} canonical Account rows in report order
 */
function buildQuickbooksAccounts(rawAccounts, rawTrialBalanceReport, rawTaxCodes = []) {
  const taxCodeNameById = new Map((rawTaxCodes || []).map((t) => [String(t.Id), t.Name]));

  return buildAccountRows({
    sourceSystem: 'quickbooks',
    sections: parseTrialBalanceReport(rawTrialBalanceReport),
    dimensionById: indexDimensionsById(rawAccounts, (a) => mapQuickbooksAccountDimension(a, taxCodeNameById)),
    fallbackDrCr: (dimension) => DR_CR_BY_CLASSIFICATION[dimension.classification],
    vendorSpecific: (dimension) => ({ classification: dimension.classification }),
  });
}

module.exports = {
  mapQuickbooksAccountDimension,
  parseTrialBalanceReport,
  buildQuickbooksAccounts,
  getQuickbooksReportDate,
  mapQuickbooksTaxCode,
  QBO_TAX_CODE_NAME_TO_CLIENT_CODE,
  DR_CR_BY_CLASSIFICATION,
};
