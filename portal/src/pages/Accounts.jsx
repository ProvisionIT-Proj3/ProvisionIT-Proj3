import { useState } from 'react';
import { api } from '../api';
import { friendlyMessage } from '../api/errors';
import { PLATFORM_LABELS } from '../constants';
import { useConnection } from '../ConnectionContext';
import { formatDate } from '../format';
import { useList } from '../hooks';
import AccountTable from '../components/AccountTable';
import PageHeader from '../components/PageHeader';
import RequireConnection from '../components/RequireConnection';
import SampleBanner from '../components/SampleBanner';

const ACCOUNT_PAGE_SIZE = 50;

function AccountList({ connection }) {
  const [page, setPage] = useState(1);
  const [sync, setSync] = useState({ status: 'idle', message: '' });
  const list = useList(
    () => api.listAccounts({ connectionId: connection.id, page, pageSize: ACCOUNT_PAGE_SIZE }),
    [connection.id, page],
  );

  const runSync = async () => {
    setSync({ status: 'running', message: '' });
    try {
      const res = await api.syncAccounts(connection.id);
      const count = res?.saved ?? res?.count;
      setSync({ status: 'done', message: count != null ? `Sync complete, ${count} accounts saved.` : 'Sync complete.' });
      list.reload();
    } catch (error) {
      setSync({ status: 'error', message: friendlyMessage(error) });
    }
  };

  const actions = (
    <>
      {sync.status === 'done' && (
        <span className="muted" role="status">
          {sync.message}
        </span>
      )}
      {sync.status === 'error' && (
        <span className="error-text" role="alert">
          {sync.message}
        </span>
      )}
      <button className="btn solid" onClick={runSync} disabled={sync.status === 'running'}>
        {sync.status === 'running' ? 'Syncing…' : 'Sync now'}
      </button>
    </>
  );

  return (
    <>
      {connection.status === 'token_expired' && (
        <div className="banner warn" role="note">
          <span>
            The sign-in for {connection.companyName} has expired, so a sync will fail until an admin reconnects it.
            The accounts below are from the last successful sync.
          </span>
        </div>
      )}
      <AccountTable
        list={list}
        onPage={setPage}
        actions={actions}
        fileName={`${connection.companyName}-accounts`.replace(/[^\w-]+/g, '-').toLowerCase()}
        emptyMessage="No accounts stored yet. Run a sync to pull them in."
      />
    </>
  );
}

export default function Accounts() {
  const { active } = useConnection();
  const subtitle = active
    ? `${active.companyName}. ${PLATFORM_LABELS[active.platform] ?? active.platform}. ${
        active.lastSyncedAt ? `Last synced ${formatDate(active.lastSyncedAt)}` : 'Not synced yet'
      }.`
    : 'Chart of accounts stored for the selected company';

  return (
    <>
      <PageHeader title="Accounts" subtitle={subtitle} />
      <SampleBanner path="/accounts">Sample data. Turn off VITE_USE_MOCK to read from the API.</SampleBanner>
      <RequireConnection>{(connection) => <AccountList connection={connection} />}</RequireConnection>
    </>
  );
}
