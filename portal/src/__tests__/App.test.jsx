import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_USE_MOCK', 'true');
});
afterEach(() => vi.unstubAllEnvs());

describe('whole portal on sample data', () => {
  it('lists companies, opens one, and moves through the pages', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/connections']}>
        <App />
      </MemoryRouter>,
    );

    // page remounts once the first company loads, so look the row up after that
    const plumb = (await screen.findByText('Plumb Co', { selector: 'button' })).closest('tr');
    expect(within(plumb).getByText('Token expired')).toBeInTheDocument();

    await user.click(within(plumb).getByRole('button', { name: 'Plumb Co' }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(await screen.findByText('Cheque Account')).toBeInTheDocument();
    expect(screen.getByLabelText('Active company')).toHaveValue('c2');

    await user.click(screen.getByRole('link', { name: 'Trial balance' }));
    expect(await screen.findByRole('heading', { name: 'Trial balance' })).toBeInTheDocument();
    expect(await screen.findByText('Accounts Receivable')).toBeInTheDocument();
  });

  it('shows the sample trial balance in balance', async () => {
    render(
      <MemoryRouter initialEntries={['/trial-balance']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/in balance/i)).toBeInTheDocument();
  });

  it('keeps the sample-data pages out of the menu but reachable by URL', async () => {
    render(
      <MemoryRouter initialEntries={['/payments']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('PAY-1000')).toBeInTheDocument();
    const menu = screen.getByRole('navigation', { name: 'Main' });
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(['Connections', 'Accounts', 'Trial balance']);
  });

  it('pages through invoices and filters by status', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/invoices']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Showing 1–10 of 12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Showing 11–12 of 12')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'paid');
    expect(await screen.findByText('Showing 1–3 of 3')).toBeInTheDocument();
  });
});
