import { afterEach, describe, expect, it, vi } from 'vitest';
import { get, post, setTokenProvider } from '../api/http';

const reply = (status, body) =>
  vi.fn().mockResolvedValue({ ok: status < 400, status, statusText: 'err', json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(async () => null);
});

describe('get', () => {
  it('sends params and skips empty ones', async () => {
    const fetchMock = reply(200, { data: [] });
    vi.stubGlobal('fetch', fetchMock);
    await get('/invoices', { connectionId: 'c1', page: 2, status: '', search: undefined });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/invoices');
    expect(url.searchParams.get('connectionId')).toBe('c1');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('search')).toBe(false);
  });

  it('post sends the method and keeps params in the query string', async () => {
    const fetchMock = reply(200, { saved: 3 });
    vi.stubGlobal('fetch', fetchMock);
    await post('/sync', { connectionId: 'c1' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(new URL(url).pathname).toBe('/api/v1/sync');
    expect(new URL(url).searchParams.get('connectionId')).toBe('c1');
  });

  it('adds the bearer token when a provider is set', async () => {
    const fetchMock = reply(200, {});
    vi.stubGlobal('fetch', fetchMock);
    setTokenProvider(async () => 'abc123');
    await get('/customers');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer abc123');
  });

  it('sends no auth header without a token', async () => {
    const fetchMock = reply(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await get('/customers');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('turns the api error format into an ApiError', async () => {
    vi.stubGlobal('fetch', reply(400, { error: { code: 'INVALID_PARAMETER', message: 'bad page' } }));
    await expect(get('/invoices')).rejects.toMatchObject({ status: 400, code: 'INVALID_PARAMETER', message: 'bad page' });
  });

  it('reports a dead server as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed to fetch')));
    await expect(get('/invoices')).rejects.toMatchObject({ status: 0 });
  });
});
