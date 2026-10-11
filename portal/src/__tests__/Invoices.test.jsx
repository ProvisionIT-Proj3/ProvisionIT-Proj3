import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ApiError } from '../api/http';
import { ConnectionProvider } from '../ConnectionContext';
import Invoices from '../pages/Invoices';

vi.mock('../api', () => ({ api: { listConnections: vi.fn(), listInvoices: vi.fn() } }));

const conn = { id: 'c1', companyName: 'Riverbend Cafe', platform: 'xero', status: 'active' };
const invoice = { id: 'i1', number: 'INV-1042', customerName: 'Acme Pty Ltd', total: 540, status: 'overdue', issueDate: '2026-08-10T12:00:00Z', dueDate: '2026-08-18T12:00:00Z' };
const pageOf = (items) => ({ items, pagination: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 } });

function setup() {
  return render(
    <MemoryRouter>
      <ConnectionProvider>
        <Invoices />
      </ConnectionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.listConnections.mockResolvedValue(pageOf([conn]));
});

describe('Invoices page', () => {
  it('shows the invoices for the active company', async () => {
    api.listInvoices.mockResolvedValue(pageOf([invoice]));
    setup();
    expect(await screen.findByText('INV-1042')).toBeInTheDocument();
    expect(screen.getByText('$540.00')).toBeInTheDocument();
    expect(screen.getByText('Overdue', { selector: '.badge' })).toBeInTheDocument();
    expect(api.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'c1', page: 1 }));
  });

  it('says so when nothing matches', async () => {
    api.listInvoices.mockResolvedValue(pageOf([]));
    setup();
    expect(await screen.findByText('No invoices match these filters.')).toBeInTheDocument();
  });

  it('shows a readable error and recovers on retry', async () => {
    api.listInvoices
      .mockRejectedValueOnce(new ApiError('boom', 500, 'SERVER_ERROR'))
      .mockResolvedValueOnce(pageOf([invoice]));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(/server ran into a problem/i);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('INV-1042')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks for the api when the server is unreachable', async () => {
    api.listInvoices.mockRejectedValue(new ApiError('Network error', 0, 'NETWORK'));
    setup();
    expect(await screen.findByRole('alert')).toHaveTextContent(/reach the server/i);
  });

  it('sends the status filter to the api', async () => {
    api.listInvoices.mockResolvedValue(pageOf([invoice]));
    setup();
    await screen.findByText('INV-1042');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'paid');
    expect(api.listInvoices).toHaveBeenLastCalledWith(expect.objectContaining({ connectionId: 'c1', status: 'paid', page: 1 }));
  });
});
