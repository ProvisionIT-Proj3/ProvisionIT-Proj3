import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { formatDateTime, statusTone } from '../format';

const body = {
  data: [
    {
      id: 'a1',
      occurredAt: '2026-10-22T09:30:00.000Z',
      action: 'sync.completed',
      outcome: 'success',
      errorCode: null,
      provider: 'xero',
      connectionId: 'c1',
      companyName: 'Riverbend Cafe',
      actorUserId: 'u1',
    },
  ],
  pagination: { page: 2, pageSize: 20, totalItems: 21, totalPages: 2 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('activity calls', () => {
  it('reads the log with paging and the routine switch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    const res = await api.listActivity({ page: 2, pageSize: 20, all: true });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/activity');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('all')).toBe('true');
    expect(res.pagination.totalPages).toBe(2);
    expect(res.items[0]).toMatchObject({ id: 'a1', action: 'sync.completed', companyName: 'Riverbend Cafe', actorUserId: 'u1' });
  });

  it('leaves the routine switch off the address by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
    vi.stubGlobal('fetch', fetchMock);
    await api.listActivity({ page: 1, pageSize: 20, all: false });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('all')).toBe(false);
  });

  it('has sample events when the portal runs on sample data', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'true');
    const res = await api.listActivity({ page: 1, pageSize: 5, all: false });
    expect(res.items).toHaveLength(5);
    expect(res.pagination.totalItems).toBeGreaterThan(5);
  });
});

describe('activity formatting', () => {
  it('colours the three results', () => {
    expect(statusTone('success')).toBe('good');
    expect(statusTone('failure')).toBe('bad');
    expect(statusTone('denied')).toBe('warn');
  });

  it('formats a time and survives bad input', () => {
    expect(formatDateTime('2026-10-22T09:30:00Z')).toMatch(/Oct/);
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('nope')).toBe('—');
  });
});
