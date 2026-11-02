import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext';
import { ACTION_LABELS, PLATFORM_LABELS } from '../constants';
import { formatDateTime, labelFor } from '../format';
import { useList } from '../hooks';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import SampleBanner from '../components/SampleBanner';
import StatusBadge from '../components/StatusBadge';

const ACTIVITY_PAGE_SIZE = 20;

// unknown actions still show up, just with a tidied name
const actionLabel = (action) => ACTION_LABELS[action] ?? labelFor(String(action ?? '').replace(/\./g, ' '));

export default function Activity() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const list = useList(
    () => api.listActivity({ page, pageSize: ACTIVITY_PAGE_SIZE, all: showAll }),
    [page, showAll],
  );

  const who = (id) => {
    if (!id) return 'System';
    return id === user?.id ? 'You' : `${id.slice(0, 8)}…`;
  };

  return (
    <>
      <PageHeader title="Activity log" subtitle="Who connected, disconnected or synced a company, and what failed" />
      <SampleBanner path="/activity">Sample data. Turn off VITE_USE_MOCK to read the real log.</SampleBanner>
      <div className="toolbar">
        <label>
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => {
              setShowAll(e.target.checked);
              setPage(1);
            }}
          />
          Include routine sign-in and permission checks
        </label>
        <button className="btn ghost" onClick={list.reload}>
          Refresh
        </button>
      </div>
      <DataTable
        columns={['When', 'What happened', 'Company', 'Result', 'Who']}
        list={list}
        onPage={setPage}
        emptyMessage="Nothing has been logged yet."
        renderRow={(e) => (
          <tr key={e.id}>
            <td>{formatDateTime(e.occurredAt)}</td>
            <td>{actionLabel(e.action)}</td>
            <td>
              {e.companyName ?? '—'}
              {e.provider && <span className="muted"> {PLATFORM_LABELS[e.provider] ?? e.provider}</span>}
            </td>
            <td>
              <StatusBadge status={e.outcome} />
              {e.errorCode && <span className="muted"> {e.errorCode}</span>}
            </td>
            <td>{who(e.actorUserId)}</td>
          </tr>
        )}
      />
    </>
  );
}
