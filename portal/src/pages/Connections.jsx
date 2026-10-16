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

  const count = connections.length;
  const subtitle = status === 'ready' ? `${count} ${count === 1 ? 'company' : 'companies'}` : 'Companies linked to an accounting platform';

  return (
    <>
      <PageHeader title="Connections" subtitle={subtitle} />
      <DataTable
        className="connections"
        columns={['Company', 'Status', 'Last synced', 'Open']}
        columnClasses={['', '', '', 'open-col']}
        list={{ status, items: connections, pagination: null, error, reload }}
        emptyMessage="No companies are connected yet."
        renderRow={(c) => (
          <tr key={c.id} className="row-link-parent">
            <td className="cell-main">
              {/* the button stretches over the whole row, so the row is one big click target */}
              <button className="row-link" onClick={() => open(c.id)}>
                {c.companyName}
              </button>
              <span className="platform">{PLATFORM_LABELS[c.platform] ?? c.platform}</span>
            </td>
            <td className="cell-status">
              <StatusBadge status={c.status} />
            </td>
            <td className="cell-date">{c.lastSyncedAt ? formatDate(c.lastSyncedAt) : <span className="soft">Not yet</span>}</td>
            <td className="cell-open" aria-hidden="true">
              Open
            </td>
          </tr>
        )}
      />
    </>
  );
}
