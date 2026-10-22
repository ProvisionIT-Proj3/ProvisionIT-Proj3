import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { friendlyMessage } from '../api/errors';
import { useConnection } from '../ConnectionContext';
import { CONNECT_PLATFORMS, PLATFORM_LABELS } from '../constants';
import { formatDate } from '../format';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';

export default function Connections() {
  const { status, connections, error, reload, select } = useConnection();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const open = (id) => {
    select(id);
    navigate('/accounts');
  };

  const connect = async (platform) => {
    setBusy(platform);
    setNote(null);
    try {
      // jumps to the provider's login, it comes back through the API callback
      window.location.assign(await api.startConnect(platform));
    } catch (err) {
      setNote({ error: true, text: friendlyMessage(err) });
      setBusy(null);
    }
  };

  const disconnect = async (c) => {
    const label = PLATFORM_LABELS[c.platform] ?? c.platform;
    if (!window.confirm(`Disconnect ${c.companyName} from ${label}? Its saved accounts will be deleted. You can connect it again later.`)) return;
    setBusy(c.id);
    setNote(null);
    try {
      await api.disconnect(c.platform, c.id);
      setNote({ error: false, text: `Disconnected ${c.companyName}.` });
      reload();
    } catch (err) {
      setNote({ error: true, text: friendlyMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Connections" subtitle="Companies linked to an accounting platform" />
      <div className="toolbar">
        {CONNECT_PLATFORMS.map((p, i) => (
          <button key={p} className={i === 0 ? 'btn' : 'btn ghost'} onClick={() => connect(p)} disabled={busy !== null}>
            {busy === p ? 'Opening…' : `Connect ${PLATFORM_LABELS[p]}`}
          </button>
        ))}
        <button className="btn ghost" onClick={reload}>
          Refresh
        </button>
      </div>
      <p className="muted">After you approve access, the browser shows a confirmation page. Come back to this tab and press Refresh.</p>
      {note && (
        <p className={note.error ? 'error-text' : 'muted'} role={note.error ? 'alert' : 'status'}>
          {note.text}
        </p>
      )}
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
              <div className="row-actions">
                <button className="btn ghost sm" onClick={() => open(c.id)}>
                  View accounts
                </button>
                {CONNECT_PLATFORMS.includes(c.platform) && (
                  <button className="btn ghost sm danger" onClick={() => disconnect(c)} disabled={busy !== null}>
                    {busy === c.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                )}
              </div>
            </td>
          </tr>
        )}
      />
    </>
  );
}
