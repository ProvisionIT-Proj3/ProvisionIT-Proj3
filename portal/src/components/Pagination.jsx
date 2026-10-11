export default function Pagination({ pagination, onPage }) {
  if (!pagination || !pagination.totalItems) return null;
  const { page, pageSize, totalItems, totalPages } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="pagination">
      <span>
        Showing {from}–{to} of {totalItems}
      </span>
      <div className="pager">
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button className="btn ghost sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
