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
    const plumb = (await screen.findByText('Plumb Co', { selector: 'td' })).closest('tr');
    expect(within(plumb).getByText('Token expired')).toBeInTheDocument();

    await user.click(within(plumb).getByRole('button', { name: /view accounts/i }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(await screen.findByText('Cheque Account')).toBeInTheDocument();
    expect(screen.getByLabelText('Active company')).toHaveValue('c2');

    await user.click(screen.getByRole('link', { name: 'Trial balance' }));
    expect(await screen.findByRole('heading', { name: 'Trial balance' })).toBeInTheDocument();
    expect(await screen.findByText('Accounts Receivable')).toBeInTheDocument();
  });

  it('has no invoices, payments or customers pages', async () => {
    render(
      <MemoryRouter initialEntries={['/connections']}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText('Plumb Co', { selector: 'td' });
    expect(screen.queryByRole('link', { name: 'Invoices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payments' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
  });
});
