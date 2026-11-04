const { GROUPS } = require('../mappers/shared/accountGroups');

/**
 * Canonical account rows -> CSV in the layout of the MYOB "Accounts List
 * [Detail]" export:
 *
 *   Account #,Account,Type,Dr/Cr,Header/Detail,Level,Balance,Tax Code
 *
 * Canonical rows carry a positive value and the side it sits on. The export
 * instead gives each account its group's normal side (Debit for assets and
 * expenses, Credit for liabilities, equity and income) and a Balance signed
 * against it, so an overdrawn bank account is a Debit with a negative balance.
 * Rows outside a known group (Unclassified, or headers stored before the group
 * scheme) keep their own side.
 *
 * Account # is whatever the accounting system holds; it is passed through, not
 * reformatted.
 */

const COLUMNS = ['Account #', 'Account', 'Type', 'Dr/Cr', 'Header/Detail', 'Level', 'Balance', 'Tax Code'];
const SIDE_NAME = { Dr: 'Debit', Cr: 'Credit' };
const NORMAL_SIDE_BY_CODE = new Map(Object.values(GROUPS).map((g) => [g.code, g.normalSide]));

// Excel and Sheets run a cell that starts with one of these as a formula, and
// account names come from outside this system.
const FORMULA_START = /^[=+\-@\t\r]/;

function textCell(value) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function line(cells) {
  return cells.join(',');
}

// dd/mm/yyyy, as in the MYOB export; null when the date isn't YYYY-MM-DD.
function displayDate(isoDate) {
  const match = typeof isoDate === 'string' && isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

function preambleLines({ companyName, reportDate }) {
  const asAt = displayDate(reportDate);
  return [
    ...(companyName ? [textCell(companyName)] : []),
    'Accounts List [Detail]',
    ...(asAt ? [`As of ${asAt}`] : []),
  ];
}

/**
 * @param {object[]} accounts canonical Account rows in report order
 * @param {object} [options]
 * @param {boolean} [options.preamble] add the company / title / as-of lines above the column row
 * @param {string} [options.companyName]
 * @param {string} [options.reportDate] 'YYYY-MM-DD'
 * @returns {string} CSV text, CRLF line endings
 */
function accountsToCsv(accounts, { preamble = false, companyName, reportDate } = {}) {
  const lines = preamble ? preambleLines({ companyName, reportDate }) : [];
  lines.push(line(COLUMNS));

  let groupSide; // normal side of the level-1 header we are under
  for (const account of accounts) {
    if (account.isHeader && account.level === 1) groupSide = NORMAL_SIDE_BY_CODE.get(account.code);

    const actualSide = account.drCr;
    const side = groupSide ?? actualSide;
    const value = Number(account.value) || 0;
    const balance = actualSide && side && actualSide !== side ? -value : value;

    lines.push(
      line([
        textCell(account.code),
        textCell(account.name),
        textCell(account.type),
        textCell(SIDE_NAME[side]),
        account.isHeader ? 'Header' : 'Detail',
        account.level ?? '',
        balance.toFixed(2),
        textCell(account.taxCode),
      ])
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { accountsToCsv, COLUMNS };
