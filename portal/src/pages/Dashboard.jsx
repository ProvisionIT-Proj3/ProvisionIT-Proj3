import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { friendlyMessage } from '../api/errors';
import { useConnection } from '../ConnectionContext';
import { PLATFORM_LABELS } from '../constants';
import ErrorBanner from '../components/ErrorBanner';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/StatusBadge';

// "2 hours ago", or "Never" if it hasn't synced
function timeAgo(value) {
  if (!value) return 'Never';
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (Number.isNaN(mins)) return 'Never';
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function Kpi({ label, value, note, tone }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      <span className={`kpi-note ${tone ?? ''}`}>{note}</span>
    </div>
  );
}

export default function Dashboard() {
  const { status, connections, error, reload, select } = useConnection();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);

  const label = (c) => PLATFORM_LABELS[c.platform] ?? c.platform;
  const active = connections.filter((c) => c.status === 'active');
  const issues = connections.filter((c) => c.status !== 'active');
  const platforms = [...new Set(connections.map(label))];
  const times = connections.map((c) => new Date(c.lastSyncedAt ?? '').getTime()).filter((t) => !Number.isNaN(t));
  const latest = times.length ? Math.max(...times) : null;
  const latestCompany = connections.find((c) => new Date(c.lastSyncedAt ?? '').getTime() === latest)?.companyName;
  const show = status !== 'error' && (status === 'ready' || connections.length > 0);

  const open = (id) => {
    select(id);
    navigate('/accounts');
  };

  const syncNow = async (c) => {
    setBusyId(c.id);
    setNote(null);
    try {
      const res = await api.syncAccounts(c.id);
      const count = res?.saved ?? res?.count;
      setNote({ error: false, text: `Synced ${c.companyName}${count != null ? `, ${count} accounts saved` : ''}.` });
      reload();
    } catch (err) {
      setNote({ error: true, text: friendlyMessage(err) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Overview across all connected companies" />
      {status === 'error' && <ErrorBanner error={error} onRetry={reload} />}
      {status === 'loading' && connections.length === 0 && <p className="muted">Loading companies…</p>}
      {show && connections.length === 0 && (
        <p className="empty-state">No companies are connected yet. An admin needs to set one up first.</p>
      )}
      {show && connections.length > 0 && (
        <>
          <div className="kpis">
            <Kpi label="Active connections" value={active.length} note={`of ${connections.length} connected`} />
            <Kpi label="Platforms" value={platforms.length} note={platforms.join(', ')} />
            <Kpi label="Last sync" value={timeAgo(latest)} note={latestCompany ?? 'No sync yet'} />
            <Kpi
              label="Needs attention"
              value={issues.length}
              note={issues.length ? 'See the list below' : 'All healthy'}
              tone={issues.length ? 'bad' : 'good'}
            />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Needs attention</h2>
            </div>
            {issues.length === 0 ? (
              <p className="muted">Nothing needs attention.</p>
            ) : (
              <ul className="attention">
                {issues.map((c) => (
                  <li key={c.id}>
                    <div>
                      {c.companyName}
                      <small>{label(c)}</small>
                    </div>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Companies</h2>
              <span>{connections.length} connected</span>
            </div>
            {note && (
              <p className={note.error ? 'error-text' : 'muted'} role={note.error ? 'alert' : 'status'}>
                {note.text}
              </p>
            )}
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Last synced</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>{c.companyName}</td>
                    <td>
                      <span className={`dot ${c.platform}`} />
                      {label(c)}
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>{timeAgo(c.lastSyncedAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="btn ghost sm" onClick={() => open(c.id)}>
                          View accounts
                        </button>
                        <button className="btn ghost sm" onClick={() => syncNow(c)} disabled={busyId !== null}>
                          {busyId === c.id ? 'Syncing…' : 'Sync now'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
