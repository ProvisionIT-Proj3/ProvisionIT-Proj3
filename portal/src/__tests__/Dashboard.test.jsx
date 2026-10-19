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

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
}

describe('dashboard', () => {
  it('counts the companies and lists the one that needs attention', async () => {
    renderHome();
    await screen.findByText('Riverbend Cafe', { selector: 'td' });
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    const active = screen.getByText('Active connections').closest('.kpi');
    expect(within(active).getByText('2')).toBeInTheDocument();
    expect(within(active).getByText('of 3 connected')).toBeInTheDocument();

    const attention = screen.getByRole('heading', { name: 'Needs attention' }).closest('section');
    expect(within(attention).getByText('Plumb Co')).toBeInTheDocument();
    expect(within(attention).getByText('Token expired')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('syncs one company from its row', async () => {
    const user = userEvent.setup();
    renderHome();
    const row = (await screen.findByText('Riverbend Cafe', { selector: 'td' })).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText(/Synced Riverbend Cafe, \d+ accounts saved/)).toBeInTheDocument();
  });

  it('opens a company on the accounts page', async () => {
    const user = userEvent.setup();
    renderHome();
    const row = (await screen.findByText('Plumb Co', { selector: 'td' })).closest('tr');
    await user.click(within(row).getByRole('button', { name: 'View accounts' }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByLabelText('Active company')).toHaveValue('c2');
  });
});
