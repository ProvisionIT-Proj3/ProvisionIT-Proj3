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
const rent = { id: 'r', code: '4400', name: 'Rent', type: 'Expense', drCr: 'Dr', isHeader: false, level: 1, value: 800 };
const sales = { id: 's', code: '2000', name: 'Sales', type: 'Revenue', drCr: 'Cr', isHeader: false, level: 1, value: 800 };
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
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    expect(await screen.findByText('Sync complete, 9 accounts saved.')).toBeInTheDocument();
    expect(api.syncAccounts).toHaveBeenCalledWith('c1');
    expect(api.listAccounts).toHaveBeenCalledTimes(2);
  });

  it('shows a readable message when sync is not allowed', async () => {
    api.listAccounts.mockResolvedValue(pageOf([bank]));
    api.syncAccounts.mockRejectedValue(new ApiError('Forbidden', 403, 'FORBIDDEN'));
    setup();
    await screen.findByText('Cheque Account');
    await userEvent.click(screen.getByRole('button', { name: /sync now/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/don't have access/i);
  });

  it('filters by code, name or type and says how many matched', async () => {
    api.listAccounts.mockResolvedValue(pageOf([header, bank, rent, sales]));
    setup();
    await screen.findByText('Cheque Account');

    await userEvent.type(screen.getByRole('searchbox', { name: /search accounts/i }), 'rent');
    expect(screen.queryByText('Cheque Account')).not.toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 accounts');

    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText('No accounts match "zzz".')).toBeInTheDocument();
  });

  it('collapses a section from its header', async () => {
    api.listAccounts.mockResolvedValue(pageOf([header, bank]));
    setup();
    await screen.findByText('Cheque Account');

    const toggle = screen.getByRole('button', { name: 'Assets' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Cheque Account')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByText('Cheque Account')).toBeInTheDocument();
  });

  it('shows whether debits and credits match', async () => {
    api.listAccounts.mockResolvedValue(pageOf([rent, sales]));
    setup();
    expect(await screen.findByText(/in balance/i)).toBeInTheDocument();
  });

  it('flags a trial balance that does not add up', async () => {
    api.listAccounts.mockResolvedValue(pageOf([bank, sales]));
    setup();
    expect(await screen.findByText(/out of balance by \$450\.50/i)).toBeInTheDocument();
  });

  it('skips the balance check when the list is split over several pages', async () => {
    api.listAccounts.mockResolvedValue({ items: [bank], pagination: { page: 1, pageSize: 50, totalItems: 80, totalPages: 2 } });
    setup();
    await screen.findByText('Cheque Account');
    expect(screen.queryByText(/balance\./i)).not.toBeInTheDocument();
  });

  it('warns when the connection sign-in has expired', async () => {
    api.listConnections.mockResolvedValue(pageOf([{ ...conn, status: 'token_expired' }]));
    api.listAccounts.mockResolvedValue(pageOf([bank]));
    setup();
    expect(await screen.findByRole('note')).toHaveTextContent(/sign-in for Riverbend Cafe has expired/i);
  });
});
