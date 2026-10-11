import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, labelFor, statusTone } from '../format';
import { friendlyMessage } from '../api/errors';

describe('format helpers', () => {
  it('formats money, including numeric strings from the db', () => {
    expect(formatMoney(540)).toBe('$540.00');
    expect(formatMoney('1220')).toBe('$1,220.00');
    expect(formatMoney(null)).toBe('—');
  });

  it('formats dates and survives bad input', () => {
    expect(formatDate('2026-08-18T12:00:00Z')).toMatch(/Aug 2026/);
    expect(formatDate(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('turns db status values into labels and tones', () => {
    expect(labelFor('awaiting_payment')).toBe('Awaiting payment');
    expect(statusTone('paid')).toBe('good');
    expect(statusTone('overdue')).toBe('bad');
    expect(statusTone('something_new')).toBe('muted');
  });

  it('has a readable message for each kind of failure', () => {
    expect(friendlyMessage({ status: 0 })).toMatch(/reach the server/);
    expect(friendlyMessage({ status: 401 })).toMatch(/signed in/);
    expect(friendlyMessage({ status: 404 })).toMatch(/wasn't found/);
    expect(friendlyMessage({ status: 400, message: 'page must be positive' })).toBe('page must be positive');
    expect(friendlyMessage({ status: 500 })).toMatch(/server ran into a problem/);
  });
});
