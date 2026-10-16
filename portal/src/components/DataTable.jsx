import ErrorBanner from './ErrorBanner';
import Pagination from './Pagination';

export default function DataTable({ columns, columnClasses = [], list, renderRow, emptyMessage, onPage, className = '' }) {
  const { status, items, pagination, error, reload } = list;
  const firstLoad = status === 'loading' && items.length === 0;
  const busy = status === 'loading' && !firstLoad;

  return (
    <div>
      {status === 'error' && <ErrorBanner error={error} onRetry={reload} />}
      <table className={[className, busy ? 'is-loading' : ''].join(' ').trim()} aria-busy={status === 'loading'}>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={columnClasses[i] || undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {firstLoad &&
            [0, 1, 2, 3, 4].map((i) => (
              <tr key={i} className="skeleton">
                <td colSpan={columns.length}>
                  <span />
                </td>
              </tr>
            ))}
          {status === 'ready' && items.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="empty">
                {emptyMessage}
              </td>
            </tr>
          )}
          {items.map(renderRow)}
        </tbody>
      </table>
      <Pagination pagination={pagination} onPage={onPage} />
    </div>
  );
}
