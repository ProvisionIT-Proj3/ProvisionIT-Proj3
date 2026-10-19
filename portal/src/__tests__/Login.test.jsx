import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const fake = vi.hoisted(() => {
  const state = { session: null, listeners: new Set() };
  const emit = () => state.listeners.forEach((fn) => fn('CHANGE', state.session));
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((fn) => {
        state.listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => state.listeners.delete(fn) } } };
      }),
      signInWithPassword: vi.fn(async ({ email, password }) => {
        if (password !== 'right') {
          return { error: Object.assign(new Error('Invalid login credentials'), { status: 400 }) };
        }
        state.session = { access_token: 'tok-123', user: { email } };
        emit();
        return { error: null };
      }),
      signOut: vi.fn(async () => {
        state.session = null;
        emit();
        return { error: null };
      }),
    },
  };
  return { state, client };
});

vi.mock('../auth/supabase', () => ({ supabase: fake.client }));

const connections = {
  data: [{ connection_id: 'c1', company_name: 'Riverbend Cafe', platform: 'xero', status: 'active', date_connected: '2026-08-12T09:00:00Z' }],
};

let fetchMock;

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  fake.state.session = null;
  fake.state.listeners.clear();
  vi.stubEnv('VITE_USE_MOCK', 'false');
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => connections }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('login', () => {
  it('sends a signed-out visitor to the sign in page without calling the API', async () => {
    renderAt('/accounts');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an error for a wrong password and stays on the form', async () => {
    const user = userEvent.setup();
    renderAt('/connections');
    await user.type(await screen.findByLabelText('Email'), 'gio@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('signs in, sends the token to the API, then signs out again', async () => {
    const user = userEvent.setup();
    renderAt('/connections');
    await user.type(await screen.findByLabelText('Email'), 'gio@example.com');
    await user.type(screen.getByLabelText('Password'), 'right');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Riverbend Cafe', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('gio@example.com')).toBeInTheDocument();
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer tok-123');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('skips the sign in page when a session already exists', async () => {
    fake.state.session = { access_token: 'tok-abc', user: { email: 'admin@example.com' } };
    renderAt('/login');
    expect(await screen.findByText('Riverbend Cafe', { selector: 'td' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});
