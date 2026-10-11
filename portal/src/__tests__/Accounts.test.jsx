import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ApiError } from '../api/http';
import { ConnectionProvider } from '../ConnectionContext';
import Accounts from '../pages/Accounts';

vi.mock('../api', () => ({
  api: { listConnections: vi.fn(), listAccounts: vi.fn(), syncAccounts: vi.fn() },
}));

const conn = { id: 'c1', companyName: 'Riverbend Cafe', platform: 'xero', status: 'active' };
const header = { id: 'h', code: null, name: 'Assets', type: 'Asset', drCr: 'Dr', isHeader: true, level: 0, value: null };
const bank = { id: 'b', code: '1000', name: 'Cheque Account', type: 'Bank', drCr: 'Dr', isHeader: false, level: 1, value: 1250.5 };
const pageOf = (items) => ({ items, pagination: { page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 } });

function setup() {
  return render(
    <MemoryRouter>
      <ConnectionProvider>
        <Accounts />
      </ConnectionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listConnections.mockResolvedValue(pageOf([conn]));
});

describe('Accounts page', () => {
  it('shows headers and balances for the active company', async () => {
    api.listAccounts.mockResolvedValue(pageOf([header, bank]));
    setup();
    expect(await screen.findByText('Cheque Account')).toBeInTheDocument();
    expect(screen.getByText('$1,250.50')).toBeInTheDocument();
    expect(screen.getByText('Assets').closest('tr')).toHaveClass('row-header');
    expect(api.listAccounts).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', page: 1 }));
  });

  it('says so when nothing is stored yet', async () => {
    api.listAccounts.mockResolvedValue(pageOf([]));
    setup();
    expect(await screen.findByText(/no accounts stored yet/i)).toBeInTheDocument();
  });

  it('sync calls the api then reloads the list', async () => {
    api.listAccounts.mockResolvedValue(pageOf([bank]));
    api.syncAccounts.mockResolvedValue({ saved: 9 });
    setup();
    await screen.findByText('Cheque Account');
    await userEvent.click(screen.getByRole('button', { name: /sync from accounting system/i }));
    expect(await screen.findByText('Sync complete, 9 accounts saved.')).toBeInTheDocument();
    expect(api.syncAccounts).toHaveBeenCalledWith('c1');
    expect(api.listAccounts).toHaveBeenCalledTimes(2);
  });

  it('shows a readable message when sync is not allowed', async () => {
    api.listAccounts.mockResolvedValue(pageOf([bank]));
    api.syncAccounts.mockRejectedValue(new ApiError('Forbidden', 403, 'FORBIDDEN'));
    setup();
    await screen.findByText('Cheque Account');
    await userEvent.click(screen.getByRole('button', { name: /sync from accounting system/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't have access/i);
  });
});
