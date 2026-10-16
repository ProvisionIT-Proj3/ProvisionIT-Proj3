import { describe, expect, it } from 'vitest';
import { accountsToCsv } from '../csv';

const header = { isHeader: true, name: 'Expenses' };
const row = (over) => ({ isHeader: false, code: '400', name: 'Advertising', type: 'Expense', drCr: 'Dr', value: 2100, ...over });

describe('accountsToCsv', () => {
  it('writes one line per account under its section, skipping header rows', () => {
    const csv = accountsToCsv([header, row({}), row({ code: '404', name: 'Bank fees', value: 312.5 })]);
    expect(csv.split('\r\n')).toEqual([
      'Section,Code,Account,Type,Dr/Cr,Balance',
      'Expenses,400,Advertising,Expense,Dr,2100.00',
      'Expenses,404,Bank fees,Expense,Dr,312.50',
      '',
    ]);
  });

  it('quotes commas and quotes in names', () => {
    const csv = accountsToCsv([row({ name: 'Light, "Power" and Heating' })]);
    expect(csv).toContain('"Light, ""Power"" and Heating"');
  });

  it('stops a name from being run as a spreadsheet formula', () => {
    const csv = accountsToCsv([row({ name: '=HYPERLINK("http://example.com")' })]);
    expect(csv).toContain(`"'=HYPERLINK(""http://example.com"")"`);
  });

  it('leaves negative balances as numbers', () => {
    expect(accountsToCsv([row({ value: -50 })])).toContain(',-50.00');
  });

  it('leaves the balance blank when there is none', () => {
    expect(accountsToCsv([row({ value: null })])).toContain('Dr,\r\n');
  });
});
