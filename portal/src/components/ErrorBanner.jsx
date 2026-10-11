import { friendlyMessage } from '../api/errors';

export default function ErrorBanner({ error, onRetry }) {
  return (
    <div className="banner error" role="alert">
      <span>{friendlyMessage(error)}</span>
      {onRetry && (
        <button className="btn ghost sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
