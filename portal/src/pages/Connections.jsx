import { useNavigate } from 'react-router-dom';
import { useConnection } from '../ConnectionContext';
import { PLATFORM_LABELS } from '../constants';
import { formatDate } from '../format';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';

export default function Connections() {
  const { status, connections, error, reload, select } = useConnection();
  const navigate = useNavigate();

  const open = (id) => {
    select(id);
    navigate('/accounts');
  };

  return (
    <>
      <PageHeader title="Connections" subtitle="Companies linked to an accounting platform" />
      <DataTable
        columns={['Company', 'Platform', 'Status', 'Connected', 'Last synced', '']}
        list={{ status, items: connections, pagination: null, error, reload }}
        emptyMessage="No companies are connected yet."
        renderRow={(c) => (
          <tr key={c.id}>
            <td>{c.companyName}</td>
            <td>{PLATFORM_LABELS[c.platform] ?? c.platform}</td>
            <td>
              <StatusBadge status={c.status} />
            </td>
            <td>{formatDate(c.connectedAt)}</td>
            <td>{c.lastSyncedAt ? formatDate(c.lastSyncedAt) : 'Never'}</td>
            <td>
              <button className="btn ghost sm" onClick={() => open(c.id)}>
                View accounts
              </button>
            </td>
          </tr>
        )}
      />
    </>
  );
}
