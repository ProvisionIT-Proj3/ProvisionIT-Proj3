import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

// A fake Supabase client: no network, we decide what the login service answers.
const fake = vi.hoisted(() => {
  const state = { session: null };
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(async () => {
        state.session = null;
        return { error: null };
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  };
  return { state, client };
});

vi.mock('../auth/supabaseClient', () => ({
  isAuthEnabled: () => true,
  getSupabase: () => fake.client,
}));

const session = { access_token: 'tok-123', user: { email: 'admin@example.com' } };
let fetchMock;

beforeEach(() => {
  localStorage.clear();
  fake.state.session = null;
  fake.client.auth.signInWithPassword.mockReset();
  vi.stubEnv('VITE_USE_MOCK', 'false');
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={['/connections']}>
      <App />
    </MemoryRouter>,
  );

describe('login', () => {
  it('shows the sign in form and makes no API call while signed out', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Accounts' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a vague error for a wrong password and stays on the form', async () => {
    const user = userEvent.setup();
    fake.client.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid login credentials' },
    });
    renderApp();

    await user.type(await screen.findByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says so when the login service cannot be reached', async () => {
    const user = userEvent.setup();
    fake.client.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
    });
    renderApp();

    await user.type(await screen.findByLabelText('Email'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the login service");
  });

  it('opens the portal after sign in and sends the access token to the API', async () => {
    const user = userEvent.setup();
    fake.client.auth.signInWithPassword.mockImplementation(async () => {
      fake.state.session = session;
      return { data: { session }, error: null };
    });
    renderApp();

    await user.type(await screen.findByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'right-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('link', { name: 'Accounts' })).toBeInTheDocument();
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe('/api/v1/connections');
    expect(options.headers.Authorization).toBe('Bearer tok-123');
  });

  it('skips the form when a saved session already exists, and sign out returns to it', async () => {
    const user = userEvent.setup();
    fake.state.session = session;
    renderApp();

    expect(await screen.findByRole('link', { name: 'Accounts' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fake.client.auth.signOut).toHaveBeenCalled();
  });
});
