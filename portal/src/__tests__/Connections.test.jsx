import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ApiError } from '../api/http';
import { ConnectionProvider } from '../ConnectionContext';
import Connections from '../pages/Connections';

vi.mock('../api', () => ({
  api: { listConnections: vi.fn(), startConnect: vi.fn(), disconnect: vi.fn() },
}));

const xero = { id: 'c1', companyName: 'Riverbend Cafe', platform: 'xero', status: 'active', connectedAt: '2026-08-12T09:00:00Z', lastSyncedAt: null };
const myob = { id: 'c2', companyName: 'Plumb Co', platform: 'myob', status: 'active', connectedAt: '2026-07-03T09:00:00Z', lastSyncedAt: null };
const pageOf = (items) => ({ items, pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 } });

function setup() {
  return render(
    <MemoryRouter>
      <ConnectionProvider>
        <Connections />
      </ConnectionProvider>
    </MemoryRouter>,
  );
}

const rowOf = async (name) => (await screen.findByText(name, { selector: 'td' })).closest('tr');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listConnections.mockResolvedValue(pageOf([xero]));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('connect', () => {
  it('sends the browser to the provider login', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    api.startConnect.mockResolvedValue('https://login.xero.com/authorize?state=abc');
    setup();
    await rowOf('Riverbend Cafe');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Xero' }));
    expect(api.startConnect).toHaveBeenCalledWith('xero');
    expect(assign).toHaveBeenCalledWith('https://login.xero.com/authorize?state=abc');
  });

  it('offers QuickBooks too', async () => {
    setup();
    await rowOf('Riverbend Cafe');
    expect(screen.getByRole('button', { name: 'Connect QuickBooks' })).toBeInTheDocument();
  });

  it('shows why it failed, for example a non-admin', async () => {
    api.startConnect.mockRejectedValue(new ApiError('Forbidden', 403, 'INSUFFICIENT_PERMISSION'));
    setup();
    await rowOf('Riverbend Cafe');
    await userEvent.click(screen.getByRole('button', { name: 'Connect Xero' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
  });
});

describe('disconnect', () => {
  it('asks first, then removes the company and reloads the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.disconnect.mockResolvedValue(undefined);
    setup();
    const row = await rowOf('Riverbend Cafe');
    await userEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Riverbend Cafe'));
    expect(api.disconnect).toHaveBeenCalledWith('xero', 'c1');
    expect(await screen.findByText('Disconnected Riverbend Cafe.')).toBeInTheDocument();
    expect(api.listConnections).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the admin cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup();
    const row = await rowOf('Riverbend Cafe');
    await userEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
    expect(api.disconnect).not.toHaveBeenCalled();
  });

  it('shows the reason when the API refuses', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.disconnect.mockRejectedValue(new ApiError('Forbidden', 403, 'INSUFFICIENT_PERMISSION'));
    setup();
    const row = await rowOf('Riverbend Cafe');
    await userEvent.click(within(row).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
  });

  it('has no Disconnect button for a platform the API cannot disconnect', async () => {
    api.listConnections.mockResolvedValue(pageOf([myob]));
    setup();
    const row = await rowOf('Plumb Co');
    expect(within(row).queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });
});
