import { describe, expect, it } from 'vitest';
import { normalizeAccount } from '../api/normalize';
import { isSample } from '../api/sample';

describe('normalizeAccount', () => {
  it('reads db-style fields', () => {
    expect(
      normalizeAccount({ source_id: 'x1', code: '1000', name: 'Bank', type: 'Bank', dr_cr: 'Dr', is_header: false, level: '1', value: '12.5', tax_code: 'GST' }),
    ).toEqual({ id: 'x1', code: '1000', name: 'Bank', type: 'Bank', drCr: 'Dr', isHeader: false, level: 1, value: 12.5, taxCode: 'GST' });
  });

  it('reads canonical camelCase fields', () => {
    const a = normalizeAccount({ id: 'a', name: 'Assets', drCr: 'Dr', isHeader: true, level: 0, value: null });
    expect(a).toMatchObject({ id: 'a', drCr: 'Dr', isHeader: true, level: 0, value: null });
  });

  it('defaults missing level to 0 and header to false', () => {
    expect(normalizeAccount({ id: 'z', name: 'Z' })).toMatchObject({ level: 0, isHeader: false, value: null });
  });
});

describe('isSample', () => {
  it('always uses sample data for pages the api lacks', () => {
    expect(isSample('/invoices')).toBe(true);
    expect(isSample('/accounts')).toBe(false);
  });
});
