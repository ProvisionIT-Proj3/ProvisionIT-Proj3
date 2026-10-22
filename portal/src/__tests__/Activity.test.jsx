import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ApiError } from '../api/http';
import Activity from '../pages/Activity';

vi.mock('../api', () => ({ api: { listActivity: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me-0000-1111' } }) }));

const disconnect = {
  id: 'a1',
  occurredAt: '2026-10-22T09:30:00Z',
  action: 'connection.disconnected',
  outcome: 'success',
  errorCode: null,
  provider: 'xero',
  companyName: 'Riverbend Cafe',
  actorUserId: 'me-0000-1111',
};
const failed = {
  id: 'a2',
  occurredAt: '2026-10-22T09:00:00Z',
  action: 'oauth.failed',
  outcome: 'failure',
  errorCode: 'INVALID_OAUTH_STATE',
  provider: 'xero',
  companyName: null,
  actorUserId: 'other-9999-8888',
};
const pageOf = (items, extra = {}) => ({
  items,
  pagination: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, ...extra },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Activity page', () => {
  it('shows readable events with the company, result and who did it', async () => {
    api.listActivity.mockResolvedValue(pageOf([disconnect, failed]));
    render(<Activity />);
    expect(await screen.findByText('Company disconnected')).toBeInTheDocument();
    expect(screen.getByText('Riverbend Cafe')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.getByText('Authorisation failed')).toBeInTheDocument();
    expect(screen.getByText('INVALID_OAUTH_STATE')).toBeInTheDocument();
    expect(screen.getByText('other-99…')).toBeInTheDocument();
  });

  it('still shows an action it has no label for', async () => {
    api.listActivity.mockResolvedValue(pageOf([{ ...failed, id: 'a3', action: 'report.exported' }]));
    render(<Activity />);
    expect(await screen.findByText('Report exported')).toBeInTheDocument();
  });

  it('asks for routine events only when the box is ticked, back on page 1', async () => {
    api.listActivity.mockResolvedValue(pageOf([disconnect]));
    render(<Activity />);
    await screen.findByText('Company disconnected');
    expect(api.listActivity).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, all: false });
    await userEvent.click(screen.getByLabelText(/routine sign-in/i));
    await screen.findByText('Company disconnected');
    expect(api.listActivity).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, all: true });
  });

  it('goes to the next page', async () => {
    api.listActivity.mockResolvedValue(pageOf([disconnect], { totalItems: 30, totalPages: 2 }));
    render(<Activity />);
    await screen.findByText('Company disconnected');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Company disconnected');
    expect(api.listActivity).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, all: false });
  });

  it('says so when nothing is logged', async () => {
    api.listActivity.mockResolvedValue(pageOf([]));
    render(<Activity />);
    expect(await screen.findByText('Nothing has been logged yet.')).toBeInTheDocument();
  });

  it('tells a non-admin they have no access', async () => {
    api.listActivity.mockRejectedValue(new ApiError('Forbidden', 403, 'INSUFFICIENT_PERMISSION'));
    render(<Activity />);
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
  });
});
