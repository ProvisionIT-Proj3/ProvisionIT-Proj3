import { describe, expect, it } from 'vitest';
import { friendlyMessage } from '../api/errors';

describe('friendlyMessage on a 401', () => {
  it('shows the API reason when a connection needs authorising again', () => {
    const err = { status: 401, message: 'Xero connection needs to be authorised again.' };
    expect(friendlyMessage(err)).toBe('Xero connection needs to be authorised again.');
  });

  it('still says not signed in for a plain 401', () => {
    expect(friendlyMessage({ status: 401, message: 'Unauthorized' })).toMatch(/signed in/);
    expect(friendlyMessage({ status: 401, message: 'Invalid token' })).toMatch(/signed in/);
  });
});
