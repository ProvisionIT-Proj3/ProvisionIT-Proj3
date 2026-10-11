import { useConnection } from '../ConnectionContext';
import ErrorBanner from './ErrorBanner';

export default function RequireConnection({ children }) {
  const { status, active, error, reload } = useConnection();
  if (status === 'error') return <ErrorBanner error={error} onRetry={reload} />;
  if (status === 'loading') return <p className="muted">Loading companies…</p>;
  if (!active) return <p className="empty-state">No companies are connected yet. An admin needs to set one up first.</p>;
  return children(active);
}
