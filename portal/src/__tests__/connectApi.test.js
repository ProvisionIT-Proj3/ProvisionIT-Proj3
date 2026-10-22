import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

// body undefined means the reply has no json, like a 204
const reply = (status, body) =>
  vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    statusText: 'err',
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('connect and disconnect calls', () => {
  it('asks the API for the provider login address', async () => {
    const fetchMock = reply(200, { data: { authorizationUrl: 'https://login.xero.com/x' } });
    vi.stubGlobal('fetch', fetchMock);
    expect(await api.startConnect('xero')).toBe('https://login.xero.com/x');
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v1/auth/xero/connect');
    expect(options.headers.Accept).toBe('application/json');
  });

  it('fails clearly when the API sends no address', async () => {
    vi.stubGlobal('fetch', reply(200, { data: {} }));
    await expect(api.startConnect('xero')).rejects.toMatchObject({ status: 502 });
  });

  it('disconnect sends DELETE and copes with an empty 204 reply', async () => {
    const fetchMock = reply(204, undefined);
    vi.stubGlobal('fetch', fetchMock);
    await api.disconnect('quickbooks', 'c9');
    const [url, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe('DELETE');
    expect(new URL(url).pathname).toBe('/api/v1/auth/quickbooks/connections/c9');
  });

  it('sample data cannot connect or disconnect', async () => {
    vi.stubEnv('VITE_USE_MOCK', 'true');
    await expect(api.startConnect('xero')).rejects.toMatchObject({ status: 400 });
    await expect(api.disconnect('xero', 'c1')).rejects.toMatchObject({ status: 400 });
  });
});
