import { useState } from 'react';
import { api } from '../api';
import { friendlyMessage } from '../api/errors';
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

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={runSync} disabled={sync.status === 'running'}>
          {sync.status === 'running' ? 'Syncing…' : 'Sync from accounting system'}
        </button>
        {sync.status === 'done' && <span className="muted">{sync.message}</span>}
        {sync.status === 'error' && (
          <span className="error-text" role="alert">
            {sync.message}
          </span>
        )}
      </div>
      <AccountTable list={list} onPage={setPage} emptyMessage="No accounts stored yet. Run a sync to pull them in." />
    </>
  );
}

export default function Accounts() {
  return (
    <>
      <PageHeader title="Accounts" subtitle="Chart of accounts stored for the selected company" />
      <SampleBanner path="/accounts">Sample data. Turn off VITE_USE_MOCK to read from the API.</SampleBanner>
      <RequireConnection>{(connection) => <AccountList connection={connection} />}</RequireConnection>
    </>
  );
}
