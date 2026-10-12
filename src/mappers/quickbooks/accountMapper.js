const { parseAmount, buildAccountRows } = require('../shared/accountRows');

/**
 * QuickBooks Online Account mapper.
 * Can't come from a single QBO API call. Built from three calls combined:
 *
 *   1. GET /query?query=select * from Account — dimension data: AcctNum,
 *      Name, AccountType, Classification, TaxCodeRef. One row per account,
 *      no balances, no hierarchy.
 *   2. GET /reports/TrialBalance — balance data: Debit/Credit per account.
 *      Usually flat account rows plus a title-less GrandTotal section.
 *   3. GET /query?query=select * from TaxCode — resolves TaxCodeRef ids to
 *      tax code names, since the ids differ per QBO company.
 */

const COLUMN_INDEX = { ACCOUNT: 0, DEBIT: 1, CREDIT: 2 };

const DR_CR_BY_CLASSIFICATION = {
  Asset: 'Dr',
  Expense: 'Dr',
  Liability: 'Cr',
  Equity: 'Cr',
  Revenue: 'Cr',
};

// Keyed on the QBO AU TaxCode Name, normalised by taxCodeKey(). Names are the
// system-generated AU codes (detailed GST and Simpler GST sets), mapped onto
// the same client vocabulary as the Xero mapper. Input tax has no client code
// (Xero's INPUTTAXED doesn't either). Other names come through as
// UNMAPPED:<name>.
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

/** "GST-free non-capital" and "GST Free Non Capital" both become "GST FREE NON CAPITAL". */
function taxCodeKey(name) {
  return name.trim().toUpperCase().replace(/[-\s]+/g, ' ');
}

/**
 * Translate an Account's TaxCodeRef to the client's tax code vocabulary.
 * @param {{ value: string }} taxCodeRef
 * @param {Map<string, string>} [taxCodeNameById] - TaxCode Id -> Name, from the TaxCode query
 */
function mapQuickbooksTaxCode(taxCodeRef, taxCodeNameById = new Map()) {
  const ref = taxCodeRef?.value;
  if (ref === undefined || ref === null || ref === '') return undefined;

  const name = taxCodeNameById.get(String(ref));
  if (!name) return `UNMAPPED:${ref}`;
  return QBO_TAX_CODE_NAME_TO_CLIENT_CODE[taxCodeKey(name)] || `UNMAPPED:${name}`;
}

/**
 * Map a single raw QuickBooks Account to reference/dimension data. Not a
 * canonical record on its own.
 *
 * @param {object} qboAccount
 * @param {Map<string, string>} [taxCodeNameById]
 * @returns {{ id: string, code: string, name: string, type: string, classification: string, taxCode: string }}
 */
function mapQuickbooksAccountDimension(qboAccount, taxCodeNameById) {
  return {
    id: qboAccount.Id,
    code: qboAccount.AcctNum || qboAccount.Id, // AcctNum is optional and often blank; Id substitutes when missing
    name: qboAccount.Name,
    type: qboAccount.AccountType,
    classification: qboAccount.Classification,
    taxCode: mapQuickbooksTaxCode(qboAccount.TaxCodeRef, taxCodeNameById),
  };
}

/** Parse a report cell's numeric value; QBO reports use '' for empty cells. */
function cellNumber(cell) {
  return parseAmount(cell?.value, 'QuickBooks');
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
  let flatRows = [];

  function parseAccountRow(row) {
    const cells = row.ColData || [];

    return {
      accountId: cells[COLUMN_INDEX.ACCOUNT]?.id,
      name: cells[COLUMN_INDEX.ACCOUNT]?.value,
      debit: cellNumber(cells[COLUMN_INDEX.DEBIT]),
      credit: cellNumber(cells[COLUMN_INDEX.CREDIT]),
    };
  }

  function flushFlatRows() {
    if (flatRows.length === 0) return;

    sections.push({
      title: 'Accounts',
      rows: flatRows,
      summary: null,
    });

    flatRows = [];
  }

  for (const row of topRows) {
    if (row.type === 'Section') {
      flushFlatRows();

      const title = row.Header?.ColData?.[COLUMN_INDEX.ACCOUNT]?.value;

      // QuickBooks can return a summary-only Section (e.g. the GrandTotal row) with no account rows.
      if (!title) continue;

      const rows = (row.Rows?.Row || [])
        .filter((child) => child.type === 'Data' || child.type == null)
        .filter((child) => Array.isArray(child.ColData))
        .map(parseAccountRow);

      const summaryCells = row.Summary?.ColData;
      const summary = summaryCells
        ? {
            debit: cellNumber(summaryCells[COLUMN_INDEX.DEBIT]),
            credit: cellNumber(summaryCells[COLUMN_INDEX.CREDIT]),
          }
        : null;

      sections.push({ title, rows, summary });
      continue;
    }

    // QuickBooks Trial Balance reports usually return flat account rows at the top level.
    if ((row.type === 'Data' || row.type == null) && Array.isArray(row.ColData)) {
      const account = parseAccountRow(row);
      if (account.accountId) flatRows.push(account);
    }
  }

  flushFlatRows();

  return sections;
}

/**
 * The report's as-of date ('YYYY-MM-DD'), from Header.EndPeriod. This is the
 * company's date, not the server's. Null when the report doesn't state one.
 */
function getQuickbooksReportDate(rawReport) {
  const end = rawReport?.Header?.EndPeriod;
  return typeof end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
}

/**
 * Build the full canonical Account list — header rows and detail rows — for
 * the client's requested report shape, from the raw QuickBooks inputs.
 *
 * @param {object[]} rawAccounts - raw response array from the Account query
 * @param {object} rawTrialBalanceReport - raw response from GET /reports/TrialBalance
 * @param {object[]} [rawTaxCodes] - raw response array from the TaxCode query
 * @returns {object[]} canonical Account rows, in report order (header, then its detail rows, per section)
 */
function buildQuickbooksAccounts(rawAccounts, rawTrialBalanceReport, rawTaxCodes = []) {
  const taxCodeNameById = new Map((rawTaxCodes || []).map((t) => [String(t.Id), t.Name]));
  const dimensionById = new Map(
    (rawAccounts || []).map((a) => {
      const d = mapQuickbooksAccountDimension(a, taxCodeNameById);
      return [d.id, d];
    })
  );

  return buildAccountRows({
    sourceSystem: 'quickbooks',
    sections: parseTrialBalanceReport(rawTrialBalanceReport),
    dimensionById,
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
  DR_CR_BY_CLASSIFICATION,
};
